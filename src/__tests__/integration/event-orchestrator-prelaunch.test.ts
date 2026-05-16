import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { PIPELINE_RUN_STATUS, STAGE_RUN_STATUS } from '@/core/constants';
import type { Database } from '@/core/db/connection';
import {
  driver,
  model,
  organization,
  pipeline,
  pipelineRun,
  pipelineStage,
  project,
  provider,
  routingProfile,
  routingRule,
  stageRun,
  user,
} from '@/core/db/schema';
import { createEventOrchestrator } from '@/core/orchestrator/event-orchestrator';
import { createPipelineRunService } from '@/core/orchestrator/pipeline-run-service';
import type { GitOpsPort } from '@/core/ports/git';
import type { IsolationProvider } from '@/core/ports/isolation';
import type {
  RealtimeProvider,
  RealtimeTableEvent,
} from '@/core/ports/realtime';
import type { StageExecutor } from '@/core/ports/stage-executor';

const RUN = `flx-94-${Date.now()}`;
let db: Database;
type PipelineRunInsertCallback = (
  payload: RealtimeTableEvent<typeof pipelineRun.$inferSelect>
) => void;

beforeAll(() => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');
  db = new SupabaseDatabaseProvider(url).getConnection();
});

describe('FLX-94 pre-launch stage failures', () => {
  it('fails pre-launch retries and stops at the retry budget', async () => {
    // FLX-221: targetRepoPath is a per-project column. Leaving it null on
    // the fixture project drives the MissingProjectTargetRepoPathError
    // pre-launch retry path.
    const fixture = await createFixture({ maxRetries: 1 });
    let insertCallback: PipelineRunInsertCallback | null = null;
    const realtime = {
      subscribe: () => () => {},
      subscribeToTable: (_channel, table, event, callback) => {
        if (table === 'pipeline_run' && event === 'INSERT') {
          insertCallback = callback as typeof insertCallback;
        }
        return () => {};
      },
      async broadcast() {},
    } satisfies RealtimeProvider;
    const _executor: StageExecutor = {
      async execute() {
        throw new Error('executor should not launch without target repo path');
      },
      async cancel() {},
    };
    const isolation: IsolationProvider = {
      async acquire() {
        throw new Error('isolation should not be acquired without target repo');
      },
      async release() {},
      async findActiveByRun() {
        return null;
      },
      async listActiveByProject() {
        return [];
      },
    };
    const gitOps: GitOpsPort = {
      async commitAll() {
        return { noChanges: true };
      },
      async getHeadSha() {
        return 'deadbeef';
      },
      async push() {},
      resolveRepoIdentity() {
        return { owner: 'fluxaos', repo: 'fixture' };
      },
      async branchAheadCount() {
        return 0;
      },
    };
    const orchestrator = createEventOrchestrator(
      db,
      realtime,
      { async onTerminal() {} },
      { isolation, gitOps }
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
              .select({ status: pipelineRun.status })
              .from(pipelineRun)
              .where(eq(pipelineRun.id, fixture.run.id));
            return row?.status;
          },
          { timeout: 10_000 }
        )
        .toBe(PIPELINE_RUN_STATUS.failed);

      const rows = await db
        .select()
        .from(stageRun)
        .where(eq(stageRun.pipelineRunId, fixture.run.id));
      const byAttempt = rows.toSorted((a, b) => a.attempt - b.attempt);
      expect(byAttempt.map((row) => row.attempt)).toEqual([1, 2]);
      expect(byAttempt.map((row) => row.status)).toEqual([
        STAGE_RUN_STATUS.failed,
        STAGE_RUN_STATUS.failed,
      ]);
      expect(byAttempt[0].errorMessage).toMatch(/target_repo_path/);
      expect(byAttempt[1].errorMessage).toMatch(/target_repo_path/);
    } finally {
      orchestrator.stop();
      await cleanupFixture(fixture);
    }
  }, 15_000);

  it('increments attempt numbers for repeated stage runs', async () => {
    const fixture = await createFixture({ maxRetries: 1 });
    const service = createPipelineRunService(db);
    try {
      const first = await service.createStageRun(
        fixture.run.id,
        fixture.stage.id
      );
      const second = await service.createStageRun(
        fixture.run.id,
        fixture.stage.id
      );

      expect(first.attempt).toBe(1);
      expect(second.attempt).toBe(2);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

async function createFixture(input: { maxRetries: number }) {
  const [org] = await db
    .insert(organization)
    .values({ name: RUN, slug: `${RUN}-${Math.random()}` })
    .returning();
  const [userRow] = await db
    .insert(user)
    .values({
      orgId: org.id,
      email: `${org.slug}@test.local`,
      name: RUN,
      slug: org.slug,
    })
    .returning();
  const [projectRow] = await db
    .insert(project)
    .values({
      orgId: org.id,
      userId: userRow.id,
      name: RUN,
      slug: org.slug,
      repoUrl: 'https://github.com/fluxaos/fixture',
      defaultBranch: 'main',
    })
    .returning();
  const [driverRow] = await db
    .insert(driver)
    .values({
      name: RUN,
      slug: org.slug,
      binary: 'false',
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
    .insert(provider)
    .values({ orgId: org.id, name: RUN, type: 'test', isHealthy: true })
    .returning();
  await db
    .insert(model)
    .values({ providerId: providerRow.id, name: RUN, identifier: RUN });
  const [profileRow] = await db
    .insert(routingProfile)
    .values({ orgId: org.id, name: RUN })
    .returning();
  await db
    .insert(routingRule)
    .values({ profileId: profileRow.id, stageName: 'research' });
  const [pipe] = await db
    .insert(pipeline)
    .values({ projectId: projectRow.id, name: RUN })
    .returning();
  const [stage] = await db
    .insert(pipelineStage)
    .values({
      pipelineId: pipe.id,
      name: 'research',
      sortOrder: 0,
      gateMode: 'auto',
      maxRetries: input.maxRetries,
      driver: driverRow.slug,
      driverId: driverRow.id,
    })
    .returning();
  const [run] = await db
    .insert(pipelineRun)
    .values({ pipelineId: pipe.id, status: PIPELINE_RUN_STATUS.pending })
    .returning();

  return {
    org,
    userRow,
    projectRow,
    driverRow,
    providerRow,
    profileRow,
    pipe,
    stage,
    run,
  };
}

async function cleanupFixture(
  fixture: Awaited<ReturnType<typeof createFixture>>
) {
  await db.delete(stageRun).where(eq(stageRun.pipelineRunId, fixture.run.id));
  await db.delete(pipelineRun).where(eq(pipelineRun.id, fixture.run.id));
  await db.delete(pipelineStage).where(eq(pipelineStage.id, fixture.stage.id));
  await db.delete(pipeline).where(eq(pipeline.id, fixture.pipe.id));
  await db
    .delete(routingRule)
    .where(eq(routingRule.profileId, fixture.profileRow.id));
  await db
    .delete(routingProfile)
    .where(eq(routingProfile.id, fixture.profileRow.id));
  await db.delete(model).where(eq(model.providerId, fixture.providerRow.id));
  await db.delete(provider).where(eq(provider.id, fixture.providerRow.id));
  await db.delete(driver).where(eq(driver.id, fixture.driverRow.id));
  await db.delete(project).where(eq(project.id, fixture.projectRow.id));
  await db.delete(user).where(eq(user.id, fixture.userRow.id));
  await db.delete(organization).where(eq(organization.id, fixture.org.id));
}
