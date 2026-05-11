/**
 * FLX-197 layer 1 — auto-dispatch path acquires an isolation_environment.
 *
 * Proves that when the event-orchestrator launches a stage (the path the
 * IssueWatcher hits when an issue is filed via the UI), it calls
 * acquireIsolationEnv, leaving an active isolation_environment row keyed
 * to the pipeline_run. Before this fix, only the manual-run path (tRPC
 * trigger) acquired an env, so deploy bridge crashed on auto-dispatched
 * pipelines.
 *
 * Real Supabase, real WorktreeIsolationProvider against a tmp git repo,
 * real persona/driver/routing rows. The stage graph runner is the only
 * stub — replaced with a fake that returns a passing result doc — because
 * we don't want to actually spawn `claude` from a unit test.
 */
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGitOps } from '@/adapters/git/git-ops';
import { createWorktreeIsolationProvider } from '@/adapters/git/worktree-isolation-provider';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { FluxaosConfig } from '@/config/env';
import { PIPELINE_RUN_STATUS } from '@/core/constants';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import type { DeployBridge } from '@/core/deploy';
import { createEventOrchestrator } from '@/core/orchestrator/event-orchestrator';
import { createPipelineTerminalHook } from '@/core/orchestrator/pipeline-terminal-hook';
import type {
  RealtimeProvider,
  RealtimeTableEvent,
} from '@/core/ports/realtime';
import type {
  StageGraphInput,
  StageGraphResult,
  StageGraphRunner,
} from '@/core/ports/stage-graph-runner';
import { deleteOrgFixture } from './cleanup-fixtures';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();
const execFileAsync = promisify(execFile);

const RUN = `flx-197-${Date.now()}`;
const orgIds: string[] = [];
let repoPath: string;

afterAll(async () => {
  for (const orgId of orgIds) {
    await deleteOrgFixture(db, orgId);
  }
  if (repoPath) await rm(repoPath, { recursive: true, force: true });
  await provider.close();
});

async function gitInTmp(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

type PipelineRunInsertCallback = (
  payload: RealtimeTableEvent<typeof schema.pipelineRun.$inferSelect>
) => void;

beforeAll(async () => {
  repoPath = await mkdtemp(join(tmpdir(), `${RUN}-`));
  await gitInTmp(repoPath, ['init', '-b', 'main']);
  await gitInTmp(repoPath, ['config', 'user.email', 'iso@fluxaos.local']);
  await gitInTmp(repoPath, ['config', 'user.name', 'IsoTest']);
  await gitInTmp(repoPath, ['commit', '--allow-empty', '-m', 'initial']);
}, 30_000);

describe('FLX-197 — auto-dispatch acquires isolation environment', () => {
  it('event-orchestrator launchStage creates an active isolation_environment row keyed to the run', async () => {
    const fixture = await createFixture();
    let insertCallback: PipelineRunInsertCallback | null = null;
    const realtime: RealtimeProvider = {
      subscribe: () => () => {},
      subscribeToTable: (_channel, table, event, callback) => {
        if (table === 'pipeline_run' && event === 'INSERT') {
          insertCallback = callback as PipelineRunInsertCallback;
        }
        return () => {};
      },
      async broadcast() {},
    };

    const isolation = createWorktreeIsolationProvider({ db });
    const gitOps = createGitOps();
    const stageGraphRunner = createPassingStubRunner(() => ({
      issueId: fixture.issueRow.id,
      issueNumber: fixture.issueRow.number,
      issueTitle: fixture.issueRow.title,
      pipelineRunId: fixture.run.id,
      orgId: fixture.org.id,
      orgSlug: fixture.org.slug,
      projectId: fixture.projectRow.id,
      projectSlug: fixture.projectRow.slug,
      stageName: fixture.stage.name,
    }));

    const fluxaosConfig: FluxaosConfig = {
      artifactsRoot: undefined,
      targetRepoPath: repoPath,
      cleanupSweepIntervalMin: 60,
      cleanupStaleDays: 30,
      cleanupSessionRetentionDays: 30,
      cleanupArtifactsRetentionDays: 30,
      initResultDocScript: '.next/daemon/init-result-doc.mjs',
      ingestResultDocScript: '.next/daemon/ingest-result-doc.mjs',
    };

    // Terminal hook with a no-op deploy bridge — the test asserts on the
    // env row, not on deploy. The real bridge would need a target repo
    // and a github token; not what we're testing here.
    const noopDeployBridge: DeployBridge = {
      async deploy() {
        return { skipped: 'no-changes' };
      },
    };
    const terminalHook = createPipelineTerminalHook({
      db,
      deployBridge: noopDeployBridge,
      isolation,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    const orchestrator = createEventOrchestrator(
      db,
      realtime,
      terminalHook,
      { isolation, gitOps },
      {},
      fluxaosConfig,
      stageGraphRunner
    );

    try {
      orchestrator.start();
      const callback = insertCallback as PipelineRunInsertCallback | null;
      if (!callback) throw new Error('pipeline_run INSERT not subscribed');
      callback({
        eventType: 'INSERT',
        new: fixture.run,
        old: null,
      });

      await expect
        .poll(
          async () => {
            const [row] = await db
              .select({
                id: schema.isolationEnvironment.id,
                status: schema.isolationEnvironment.status,
                runId: schema.isolationEnvironment.runId,
              })
              .from(schema.isolationEnvironment)
              .where(
                and(
                  eq(schema.isolationEnvironment.runId, fixture.run.id),
                  eq(schema.isolationEnvironment.status, 'active')
                )
              );
            return row ?? null;
          },
          { timeout: 30_000, interval: 250 }
        )
        .toMatchObject({ status: 'active', runId: fixture.run.id });

      await expect
        .poll(
          async () => {
            const [row] = await db
              .select({ status: schema.pipelineRun.status })
              .from(schema.pipelineRun)
              .where(eq(schema.pipelineRun.id, fixture.run.id));
            return row?.status;
          },
          { timeout: 30_000, interval: 250 }
        )
        .toBe(PIPELINE_RUN_STATUS.completed);

      const [runAfter] = await db
        .select({ artifactsPath: schema.pipelineRun.artifactsPath })
        .from(schema.pipelineRun)
        .where(eq(schema.pipelineRun.id, fixture.run.id));
      expect(runAfter.artifactsPath).toBeTruthy();
      expect(runAfter.artifactsPath).toContain(fixture.run.id);
    } finally {
      orchestrator.stop();
    }
  }, 60_000);

  it('terminal hook releases the env when the pipeline reaches a non-completed terminal status', async () => {
    const fixture = await createFixture();
    let insertCallback: PipelineRunInsertCallback | null = null;
    const realtime: RealtimeProvider = {
      subscribe: () => () => {},
      subscribeToTable: (_channel, table, event, callback) => {
        if (table === 'pipeline_run' && event === 'INSERT') {
          insertCallback = callback as PipelineRunInsertCallback;
        }
        return () => {};
      },
      async broadcast() {},
    };

    const isolation = createWorktreeIsolationProvider({ db });
    const gitOps = createGitOps();
    // Failing stub — verdict='fail' and no onFail target → pipeline blocks,
    // which is a non-completed terminal status that triggers env release.
    const stageGraphRunner: StageGraphRunner = {
      async run(input) {
        const now = new Date().toISOString();
        return {
          ingestOutput: JSON.stringify({
            valid: true,
            doc: {
              issue: {
                id: fixture.issueRow.id,
                number: fixture.issueRow.number,
                title: fixture.issueRow.title,
              },
              run: {
                pipelineRunId: fixture.run.id,
                stageRunId: input.stageRunId,
                stage: fixture.stage.name,
                attempt: 1,
              },
              org: { id: fixture.org.id, slug: fixture.org.slug },
              project: {
                id: fixture.projectRow.id,
                slug: fixture.projectRow.slug,
              },
              timing: { startedAt: now, endedAt: now, duration_sec: 0 },
              verdict: 'blocked',
              summary: 'stub-blocked',
            },
          }),
        };
      },
    };

    const fluxaosConfig: FluxaosConfig = {
      artifactsRoot: undefined,
      targetRepoPath: repoPath,
      cleanupSweepIntervalMin: 60,
      cleanupStaleDays: 30,
      cleanupSessionRetentionDays: 30,
      cleanupArtifactsRetentionDays: 30,
      initResultDocScript: '.next/daemon/init-result-doc.mjs',
      ingestResultDocScript: '.next/daemon/ingest-result-doc.mjs',
    };

    const noopDeployBridge: DeployBridge = {
      async deploy() {
        return { skipped: 'no-changes' };
      },
    };
    const terminalHook = createPipelineTerminalHook({
      db,
      deployBridge: noopDeployBridge,
      isolation,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    const orchestrator = createEventOrchestrator(
      db,
      realtime,
      terminalHook,
      { isolation, gitOps },
      {},
      fluxaosConfig,
      stageGraphRunner
    );

    try {
      orchestrator.start();
      const callback = insertCallback as PipelineRunInsertCallback | null;
      if (!callback) throw new Error('pipeline_run INSERT not subscribed');
      callback({ eventType: 'INSERT', new: fixture.run, old: null });

      await expect
        .poll(
          async () => {
            const [row] = await db
              .select({ status: schema.pipelineRun.status })
              .from(schema.pipelineRun)
              .where(eq(schema.pipelineRun.id, fixture.run.id));
            return row?.status;
          },
          { timeout: 30_000, interval: 250 }
        )
        .not.toBe(PIPELINE_RUN_STATUS.pending);

      await expect
        .poll(
          async () => {
            const [row] = await db
              .select({ status: schema.isolationEnvironment.status })
              .from(schema.isolationEnvironment)
              .where(eq(schema.isolationEnvironment.runId, fixture.run.id));
            return row?.status;
          },
          { timeout: 30_000, interval: 250 }
        )
        .toBe('inactive');
    } finally {
      orchestrator.stop();
    }
  }, 60_000);
});

function createPassingStubRunner(
  ctx: () => {
    issueId: string | null;
    issueNumber: number;
    issueTitle: string;
    pipelineRunId: string;
    orgId: string;
    orgSlug: string;
    projectId: string;
    projectSlug: string;
    stageName: string;
  }
): StageGraphRunner {
  return {
    async run(input: StageGraphInput): Promise<StageGraphResult> {
      const c = ctx();
      const now = new Date().toISOString();
      const passingDoc = {
        valid: true,
        doc: {
          issue: {
            id: c.issueId ?? '00000000-0000-0000-0000-000000000000',
            number: c.issueNumber,
            title: c.issueTitle,
          },
          run: {
            pipelineRunId: c.pipelineRunId,
            stageRunId: input.stageRunId,
            stage: c.stageName,
            attempt: 1,
          },
          org: { id: c.orgId, slug: c.orgSlug },
          project: { id: c.projectId, slug: c.projectSlug },
          timing: { startedAt: now, endedAt: now, duration_sec: 0 },
          verdict: 'pass',
          summary: 'stub-pass',
          meta: { input_tokens: 0, output_tokens: 0, model: 'stub' },
        },
      };
      return { ingestOutput: JSON.stringify(passingDoc) };
    },
  };
}

async function createFixture() {
  const slug = `${RUN}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: RUN, slug })
    .returning();
  orgIds.push(org.id);

  const [userRow] = await db
    .insert(schema.user)
    .values({
      orgId: org.id,
      email: `${slug}@test.local`,
      name: RUN,
      slug,
    })
    .returning();
  const [projectRow] = await db
    .insert(schema.project)
    .values({
      orgId: org.id,
      userId: userRow.id,
      name: RUN,
      slug,
      repoUrl: 'https://github.com/fluxaos/flx-197-fixture',
      defaultBranch: 'main',
    })
    .returning();
  const [driverRow] = await db
    .insert(schema.driver)
    .values({
      name: RUN,
      slug,
      binary: 'true',
      defaultArgs: [],
      promptTransport: 'argv',
      outputFormat: 'stream-json',
      issuePromptTemplate: 'work in {{workspace_path}}',
      queuePromptTemplate: '{{issue_title}}',
      contextLayout: {
        instructionsFile: 'CLAUDE.md',
        contextFile: 'context.md',
      },
    })
    .returning();
  const [providerRow] = await db
    .insert(schema.provider)
    .values({ orgId: org.id, name: RUN, type: 'test', isHealthy: true })
    .returning();
  await db
    .insert(schema.model)
    .values({ providerId: providerRow.id, name: RUN, identifier: RUN });
  const [profileRow] = await db
    .insert(schema.routingProfile)
    .values({ orgId: org.id, name: RUN })
    .returning();
  await db
    .insert(schema.routingRule)
    .values({ profileId: profileRow.id, stageName: 'research' });
  const [personaRow] = await db
    .insert(schema.persona)
    .values({
      projectId: projectRow.id,
      name: RUN,
      soul: 'test soul',
    })
    .returning();
  const [pipe] = await db
    .insert(schema.pipeline)
    .values({ projectId: projectRow.id, name: RUN })
    .returning();
  const [stage] = await db
    .insert(schema.pipelineStage)
    .values({
      pipelineId: pipe.id,
      name: 'research',
      sortOrder: 0,
      gateMode: 'auto',
      maxRetries: 0,
      driver: driverRow.slug,
      driverId: driverRow.id,
      personaId: personaRow.id,
      onPass: '__complete__',
      // Leave onFail/fallback null so a non-pass verdict hits the
      // "routing field is null" branch in applyVerdict, which calls
      // finishRun(blocked) FIRST (and therefore the terminal hook)
      // before any optional issueService.block side effects that need
      // project config entries we don't bother seeding here.
    })
    .returning();
  const [issueType] = await db
    .insert(schema.issueType)
    .values({
      projectId: projectRow.id,
      key: 'task',
      displayName: 'Task',
      color: '#000',
      sortOrder: 0,
      isActive: true,
    })
    .returning();
  const [issueState] = await db
    .insert(schema.issueState)
    .values({
      projectId: projectRow.id,
      key: 'open',
      displayName: 'Open',
      color: '#000',
      sortOrder: 0,
      isActive: true,
      isTerminal: false,
    })
    .returning();
  const [issueStatus] = await db
    .insert(schema.issueStatus)
    .values({
      projectId: projectRow.id,
      key: 'open',
      displayName: 'Open',
      sortOrder: 0,
      isActive: true,
    })
    .returning();
  await db.insert(schema.issueStatus).values({
    projectId: projectRow.id,
    key: 'blocked',
    displayName: 'Blocked',
    sortOrder: 10,
    isActive: true,
  });
  await db.insert(schema.configEntry).values({
    scope: 'project',
    projectId: projectRow.id,
    key: 'issues.status.on_blocked_key',
    value: '"blocked"',
  });
  const [issuePriority] = await db
    .insert(schema.issuePriority)
    .values({
      projectId: projectRow.id,
      key: 'normal',
      displayName: 'Normal',
      color: '#000',
      weight: 0,
      isActive: true,
    })
    .returning();
  const [issueRow] = await db
    .insert(schema.issue)
    .values({
      projectId: projectRow.id,
      typeId: issueType.id,
      stateId: issueState.id,
      statusId: issueStatus.id,
      priorityId: issuePriority.id,
      title: `flx-197 issue ${RUN}`,
      number: 1,
    })
    .returning();
  const [run] = await db
    .insert(schema.pipelineRun)
    .values({
      pipelineId: pipe.id,
      issueId: issueRow.id,
      status: PIPELINE_RUN_STATUS.pending,
    })
    .returning();

  return {
    org,
    userRow,
    projectRow,
    driverRow,
    providerRow,
    profileRow,
    personaRow,
    pipe,
    stage,
    issueRow,
    run,
  };
}
