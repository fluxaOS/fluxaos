import 'dotenv/config';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AnyColumn } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { bootstrap } from '@/config/bootstrap';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import { createPipelineRunService } from '@/core/orchestrator/pipeline-run-service';
import { executeStageRun } from '@/core/orchestrator/stage-runner';
import type { IsolationProvider } from '@/core/ports/isolation';
import type { StageExecutor } from '@/core/ports/stage-executor';
import {
  createOrganizationService,
  createPipelineService,
  createProjectService,
  createUserService,
} from '@/core/services';

const execFileAsync = promisify(execFile);
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();
const RUN = Date.now();
const tempDirs: string[] = [];
const cleanup: { table: string; id: string }[] = [];
const tables: Record<string, AnyPgTable & { id: AnyColumn }> = {
  issueEvent: schema.issueEvent,
  stageRun: schema.stageRun,
  pipelineRun: schema.pipelineRun,
  pipelineStage: schema.pipelineStage,
  pipeline: schema.pipeline,
  issue: schema.issue,
  issueState: schema.issueState,
  issueStatus: schema.issueStatus,
  issueType: schema.issueType,
  issuePriority: schema.issuePriority,
  routingRule: schema.routingRule,
  routingProfile: schema.routingProfile,
  model: schema.model,
  provider: schema.provider,
  skill: schema.skill,
  driver: schema.driver,
  project: schema.project,
  user: schema.user,
  organization: schema.organization,
};

let previousTargetRepoPath: string | undefined;
let fixture: Awaited<ReturnType<typeof createFixture>>;

beforeAll(async () => {
  bootstrap();
  previousTargetRepoPath = process.env.FLUXAOS_TARGET_REPO_PATH;
  const targetRepoPath = await makeRepo('fluxaos-target-');
  tempDirs.push(targetRepoPath);
  process.env.FLUXAOS_TARGET_REPO_PATH = targetRepoPath;
  fixture = await createFixture();
});

afterAll(async () => {
  if (previousTargetRepoPath === undefined) {
    delete process.env.FLUXAOS_TARGET_REPO_PATH;
  } else {
    process.env.FLUXAOS_TARGET_REPO_PATH = previousTargetRepoPath;
  }
  for (const path of tempDirs.reverse()) {
    await rm(path, { recursive: true, force: true }).catch(() => {});
  }
  for (const { table, id } of cleanup.reverse()) {
    await db
      .delete(tables[table])
      .where(eq(tables[table].id, id))
      .catch(() => {});
  }
  await provider.close();
});

describe('stage-runner issue events', () => {
  it('adds stage signal summary to issue timeline events', async () => {
    const svc = createPipelineRunService(db);
    const [run] = await db
      .insert(schema.pipelineRun)
      .values({
        pipelineId: fixture.pipelineId,
        issueId: fixture.issueId,
        status: 'pending',
      })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run.id });

    const stageRun = await svc.createStageRun(run.id, fixture.stageId);
    cleanup.push({ table: 'stageRun', id: stageRun.id });

    const workingPath = await makeRepo('fluxaos-worktree-');
    const artifactsPath = await mkdtemp(join(tmpdir(), 'fluxaos-artifacts-'));
    tempDirs.push(workingPath, artifactsPath);

    const summary = 'Created the contributing guide and verified links.';
    const executor: StageExecutor = {
      async execute(params) {
        params.onStdout?.(
          `${JSON.stringify({
            'flux:signal': { verdict: 'proceed', summary },
          })}\n`
        );
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 1,
          processId: 'stage-runner-issue-events-test',
        };
      },
      async cancel() {},
    };

    await executeStageRun({
      db,
      executor,
      runService: svc,
      isolation: isolationProvider(workingPath, artifactsPath),
      runId: run.id,
      stageRunId: stageRun.id,
      trigger: 'manual',
    });

    const rows = await db
      .select()
      .from(schema.issueEvent)
      .where(eq(schema.issueEvent.issueId, fixture.issueId));
    for (const row of rows) {
      cleanup.push({ table: 'issueEvent', id: row.id });
    }

    const completed = rows.find((row) => row.type === 'stage_completed');
    expect(completed?.payload).toMatchObject({
      stageName: fixture.stageName,
      skillSignal: 'proceed',
      summary,
    });
  });
});

async function makeRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@fluxaos.local'], {
    cwd: dir,
  });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await execFileAsync('git', ['commit', '--allow-empty', '-m', 'initial'], {
    cwd: dir,
  });
  return dir;
}

async function createFixture() {
  const org = await createOrganizationService(db).create({
    name: `StageRunnerIssueEventsOrg-${RUN}`,
    slug: `stage-runner-issue-events-${RUN}`,
    settings: {},
  });
  cleanup.push({ table: 'organization', id: org.id });

  const user = await createUserService(db).create({
    orgId: org.id,
    email: `stage-runner-issue-events-${RUN}@test.local`,
    name: 'Stage Runner Issue Events User',
    slug: `stage-runner-issue-events-user-${RUN}`,
  });
  cleanup.push({ table: 'user', id: user.id });

  const project = await createProjectService(db).create({
    orgId: org.id,
    userId: user.id,
    name: `StageRunnerIssueEventsProject-${RUN}`,
    slug: `stage-runner-issue-events-project-${RUN}`,
    repoUrl: `https://github.com/fluxaos/stage-runner-issue-events-${RUN}`,
  });
  cleanup.push({ table: 'project', id: project.id });

  const pipeline = await createPipelineService(db).create({
    projectId: project.id,
    name: `Stage Runner Issue Events Pipeline ${RUN}`,
  });
  cleanup.push({ table: 'pipeline', id: pipeline.id });

  const [driver] = await db
    .insert(schema.driver)
    .values({
      name: `Issue Events Driver ${RUN}`,
      slug: `issue-events-driver-${RUN}`,
      binary: 'printf',
      defaultArgs: [],
      modelFlag: '--model',
      dirFlag: '--add-dir',
      promptTransport: 'argv',
      outputFormat: 'stream-json',
      outputFormatFlag: '--output-format',
      issuePromptTemplate: '{{skill_name}}: {{issue_title}}',
      contextLayout: {
        instructionsFile: 'CLAUDE.md',
        contextFile: 'context.md',
      },
    })
    .returning();
  cleanup.push({ table: 'driver', id: driver.id });

  const [skill] = await db
    .insert(schema.skill)
    .values({
      projectId: project.id,
      name: `issue-events-skill-${RUN}`,
      promptTemplate: 'Emit a flux signal summary.',
    })
    .returning();
  cleanup.push({ table: 'skill', id: skill.id });

  const stage = await createPipelineService(db).stages.create({
    pipelineId: pipeline.id,
    name: `issue-events-stage-${RUN}`,
    sortOrder: 1,
    gateMode: 'auto',
    maxRetries: 0,
    driver: driver.slug,
    driverId: driver.id,
    skillId: skill.id,
  });
  cleanup.push({ table: 'pipelineStage', id: stage.id });

  await createRouting(org.id, stage.name);
  const issueId = await createIssue(project.id);
  return {
    pipelineId: pipeline.id,
    stageId: stage.id,
    stageName: stage.name,
    issueId,
  };
}

async function createRouting(orgId: string, stageName: string) {
  const [providerRow] = await db
    .insert(schema.provider)
    .values({ orgId, name: `Issue Events Provider ${RUN}`, type: 'test' })
    .returning();
  cleanup.push({ table: 'provider', id: providerRow.id });
  const [modelRow] = await db
    .insert(schema.model)
    .values({
      providerId: providerRow.id,
      name: `Issue Events Model ${RUN}`,
      identifier: `issue-events-model-${RUN}`,
    })
    .returning();
  cleanup.push({ table: 'model', id: modelRow.id });
  const [profileRow] = await db
    .insert(schema.routingProfile)
    .values({ orgId, name: `Issue Events Routing ${RUN}` })
    .returning();
  cleanup.push({ table: 'routingProfile', id: profileRow.id });
  const [ruleRow] = await db
    .insert(schema.routingRule)
    .values({ profileId: profileRow.id, stageName })
    .returning();
  cleanup.push({ table: 'routingRule', id: ruleRow.id });
}

async function createIssue(projectId: string): Promise<string> {
  const [state] = await db
    .insert(schema.issueState)
    .values({
      projectId,
      key: `issue-events-state-${RUN}`,
      displayName: 'Issue Events State',
      color: '#64748b',
      sortOrder: 1,
    })
    .returning();
  cleanup.push({ table: 'issueState', id: state.id });
  const [status] = await db
    .insert(schema.issueStatus)
    .values({
      projectId,
      key: `issue-events-status-${RUN}`,
      displayName: 'Issue Events Status',
      sortOrder: 1,
    })
    .returning();
  cleanup.push({ table: 'issueStatus', id: status.id });
  const [type] = await db
    .insert(schema.issueType)
    .values({
      projectId,
      key: `issue-events-type-${RUN}`,
      displayName: 'Issue Events Type',
      color: '#64748b',
      sortOrder: 1,
    })
    .returning();
  cleanup.push({ table: 'issueType', id: type.id });
  const [priority] = await db
    .insert(schema.issuePriority)
    .values({
      projectId,
      key: `issue-events-priority-${RUN}`,
      displayName: 'Issue Events Priority',
      color: '#64748b',
      weight: 1,
    })
    .returning();
  cleanup.push({ table: 'issuePriority', id: priority.id });
  const [issue] = await db
    .insert(schema.issue)
    .values({
      projectId,
      number: 1_000_001,
      title: 'Stage summary timeline test',
      stateId: state.id,
      statusId: status.id,
      typeId: type.id,
      priorityId: priority.id,
      author: 'test',
    })
    .returning();
  cleanup.push({ table: 'issue', id: issue.id });
  return issue.id;
}

function isolationProvider(
  workingPath: string,
  artifactsPath: string
): IsolationProvider {
  return {
    async acquire(params) {
      return {
        id: `env-${params.runId}`,
        projectId: params.projectId,
        runId: params.runId,
        provider: 'test',
        workingPath,
        branchName: params.branchName,
        status: 'active',
        metadata: {},
        artifactsPath,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
    async release() {},
    async findActiveByRun() {
      return null;
    },
    async listActiveByProject() {
      return [];
    },
  };
}
