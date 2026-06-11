/**
 * Integration tests: R-MISSION-CONTROL mission.summary reader.
 *
 * Self-contained: seeds its own org/user/project/catalogs/pipeline/stage,
 * then inserts pipeline_runs at each lifecycle status + a stage_run per
 * row + an issue_pull_request, and asserts the reader projects each
 * section correctly. Project-scoping is verified via a second project
 * with no fixtures.
 *
 * FLX-275/FLX-278 — every fixture is built inside a transaction that is
 * ALWAYS rolled back (the issue-watcher-config.test.ts pattern). The
 * reader is pure SELECTs, so the tRPC caller runs on the same tx handle
 * and sees the uncommitted rows — while the live daemon never can:
 * a COMMITTED pipeline_run at status='pending' is claimed by the
 * operator daemon's orchestrator within its Realtime latency
 * (pending → running + a launched stage), which destroyed exactly the
 * state this reader asserts on. Rollback-tx fixtures are invisible to
 * the daemon by construction and leave zero residue.
 */
import 'dotenv/config';
import { TransactionRollbackError } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { PIPELINE_RUN_STATUS, STAGE_RUN_STATUS } from '@/core/constants';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import {
  createIssueCatalogService,
  createIssueService,
  createOrganizationService,
  createProjectService,
  createUserService,
} from '@/core/services';
import { appRouter } from '@/server/root';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

const RUN = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

/**
 * Run `fn` inside a transaction that is ALWAYS rolled back. Fixture rows
 * are never committed, so the live daemon (Realtime subscriber on
 * pipeline_run) can never observe or claim them.
 */
async function inRollbackTx(
  fn: (tx: Database) => Promise<void>
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fn(tx as unknown as Database);
      tx.rollback();
    });
  } catch (err) {
    // The deliberate rollback is the expected exit path; anything else
    // (including assertion failures inside `fn`) must propagate.
    if (!(err instanceof TransactionRollbackError)) throw err;
  }
}

interface McFixture {
  projectId: string;
  secondProjectId: string;
  pendingRunId: string;
  runningRunId: string;
  runningStageRunId: string;
  terminalRunId: string;
  terminalStageRunId: string;
  prId: string;
}

async function buildFixture(tx: Database): Promise<McFixture> {
  const orgSvc = createOrganizationService(tx);
  const userSvc = createUserService(tx);
  const projSvc = createProjectService(tx);
  const catalogSvc = createIssueCatalogService(tx);
  const issueSvc = createIssueService(tx);
  const dbx = tx;

  const org = await orgSvc.create({
    name: `mc-${RUN}`,
    settings: {},
  });

  const usr = await userSvc.create({
    orgId: org.id,
    email: `mc-${RUN}@test.local`,
    name: `mc-${RUN}`,
  });

  const [team] = await dbx
    .insert(schema.team)
    .values({ orgId: org.id, name: `mc-team-${RUN}` })
    .returning();
  const [team2] = await dbx
    .insert(schema.team)
    .values({
      orgId: org.id,
      name: `mc-team2-${RUN}`,
    })
    .returning();

  const proj = await projSvc.create({
    orgId: org.id,
    teamId: team.id,
    userId: usr.id,
    name: `mc-proj-${RUN}`,
  });

  const proj2 = await projSvc.create({
    orgId: org.id,
    teamId: team2.id,
    userId: usr.id,
    name: `mc-proj2-${RUN}`,
  });

  // Catalog
  const t = await catalogSvc.types.create({
    projectId: proj.id,
    key: `feat-${RUN}`,
    displayName: 'Feature',
    color: '#00ff00',
    sortOrder: 1,
  });

  await catalogSvc.states.create({
    projectId: proj.id,
    key: `open-${RUN}`,
    displayName: 'Open',
    color: '#22cc22',
    sortOrder: 1,
    isTerminal: false,
  });

  await catalogSvc.statuses.create({
    projectId: proj.id,
    key: `backlog-${RUN}`,
    displayName: 'Backlog',
    sortOrder: 1,
  });

  const priority = await catalogSvc.priorities.create({
    projectId: proj.id,
    key: `high-${RUN}`,
    displayName: 'High',
    color: '#ff0000',
    weight: 100,
  });

  await dbx
    .insert(schema.configEntry)
    .values({
      scope: 'project',
      projectId: proj.id,
      key: 'issues.status.on_create_key',
      value: `backlog-${RUN}`,
    })
    .returning();

  const iss = await issueSvc.create({
    projectId: proj.id,
    title: 'mc test issue',
    typeId: t.id,
    priorityId: priority.id,
    author: 'mc-user',
  });

  // Pipeline + stage
  const [pipe] = await dbx
    .insert(schema.pipeline)
    .values({ projectId: proj.id, name: `mc-pipe-${RUN}` })
    .returning();

  const [stage] = await dbx
    .insert(schema.pipelineStage)
    .values({
      pipelineId: pipe.id,
      name: 'research',
      sortOrder: 0,
      driver: 'claude-code',
      gateMode: 'auto',
      maxRetries: 0,
    })
    .returning();

  // Pending run
  const [pendingRun] = await dbx
    .insert(schema.pipelineRun)
    .values({
      pipelineId: pipe.id,
      issueId: iss.id,
      status: PIPELINE_RUN_STATUS.pending,
    })
    .returning();

  // Running run + launching stage_run
  const [runningRun] = await dbx
    .insert(schema.pipelineRun)
    .values({
      pipelineId: pipe.id,
      issueId: iss.id,
      status: PIPELINE_RUN_STATUS.running,
      startedAt: new Date(),
    })
    .returning();

  const [runningSr] = await dbx
    .insert(schema.stageRun)
    .values({
      pipelineRunId: runningRun.id,
      pipelineStageId: stage.id,
      status: STAGE_RUN_STATUS.launching,
    })
    .returning();

  // Terminal run + completed stage_run
  const [terminalRun] = await dbx
    .insert(schema.pipelineRun)
    .values({
      pipelineId: pipe.id,
      issueId: iss.id,
      status: PIPELINE_RUN_STATUS.completed,
      startedAt: new Date(Date.now() - 60_000),
      completedAt: new Date(),
    })
    .returning();

  const [terminalSr] = await dbx
    .insert(schema.stageRun)
    .values({
      pipelineRunId: terminalRun.id,
      pipelineStageId: stage.id,
      status: STAGE_RUN_STATUS.completed,
      startedAt: new Date(Date.now() - 60_000),
      completedAt: new Date(),
    })
    .returning();

  // PR row
  const [pr] = await dbx
    .insert(schema.issuePullRequest)
    .values({
      issueId: iss.id,
      repo: 'fluxaOS/fixture',
      provider: 'github',
      prNumber: 42,
      prUrl: `https://github.com/fluxaOS/fixture/pull/42-${RUN}`,
      title: 'mc test PR',
      state: 'open',
      headBranch: 'mc-test-branch',
      baseBranch: 'main',
    })
    .returning();

  return {
    projectId: proj.id,
    secondProjectId: proj2.id,
    pendingRunId: pendingRun.id,
    runningRunId: runningRun.id,
    runningStageRunId: runningSr.id,
    terminalRunId: terminalRun.id,
    terminalStageRunId: terminalSr.id,
    prId: pr.id,
  };
}

afterAll(async () => {
  await provider.close();
});

/** Build a tRPC caller bound to the rollback transaction handle. */
function makeCaller(tx: Database) {
  return appRouter.createCaller({
    db: tx,
    viewer: {
      authUserId: null,
      fluxaUserId: null,
      role: 'admin',
      tier: 'enterprise',
    },
  });
}

describe('R-MISSION-CONTROL mission.summary', () => {
  it('returns each section populated for the project', async () => {
    await inRollbackTx(async (tx) => {
      const f = await buildFixture(tx);
      const caller = makeCaller(tx);
      const out = await caller.mission.summary({ projectId: f.projectId });

      expect(out.pendingRuns.length).toBe(1);
      expect(out.pendingRuns[0]?.id).toBe(f.pendingRunId);
      expect(out.pendingRuns[0]?.pipelineName).toBe(`mc-pipe-${RUN}`);
      expect(out.pendingRuns[0]?.issueTitle).toBe('mc test issue');

      expect(out.runningRuns.length).toBe(1);
      expect(out.runningRuns[0]?.run.id).toBe(f.runningRunId);
      expect(out.runningRuns[0]?.currentStage?.id).toBe(f.runningStageRunId);
      expect(out.runningRuns[0]?.currentStage?.name).toBe('research');
      expect(out.runningRuns[0]?.currentStage?.status).toBe(
        STAGE_RUN_STATUS.launching
      );

      expect(out.recentTerminal.length).toBe(1);
      expect(out.recentTerminal[0]?.run.id).toBe(f.terminalRunId);
      expect(out.recentTerminal[0]?.finalStage?.id).toBe(f.terminalStageRunId);
      expect(out.recentTerminal[0]?.finalStage?.status).toBe(
        STAGE_RUN_STATUS.completed
      );

      expect(out.recentPullRequests.length).toBe(1);
      expect(out.recentPullRequests[0]?.id).toBe(f.prId);
      expect(out.recentPullRequests[0]?.prNumber).toBe(42);
      expect(out.recentPullRequests[0]?.issueTitle).toBe('mc test issue');
    });
  }, 60_000);

  it('returns empty arrays for a project with no fixtures', async () => {
    await inRollbackTx(async (tx) => {
      const f = await buildFixture(tx);
      const caller = makeCaller(tx);
      const out = await caller.mission.summary({
        projectId: f.secondProjectId,
      });
      expect(out.pendingRuns).toEqual([]);
      expect(out.runningRuns).toEqual([]);
      expect(out.recentTerminal).toEqual([]);
      expect(out.recentPullRequests).toEqual([]);
    });
  }, 60_000);
});
