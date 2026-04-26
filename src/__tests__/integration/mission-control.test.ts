/**
 * Integration tests: R-MISSION-CONTROL mission.summary reader.
 *
 * Self-contained: seeds its own org/user/project/catalogs/pipeline/stage,
 * then inserts pipeline_runs at each lifecycle status + a stage_run per
 * row + an issue_pull_request, and asserts the reader projects each
 * section correctly. Project-scoping is verified via a second project
 * with no fixtures.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
const cleanup: Array<() => Promise<void>> = [];

let projectId: string;
let secondProjectId: string;
let _pipelineId: string;
let _stageId: string;
let issueId: string;

let pendingRunId: string;
let runningRunId: string;
let runningStageRunId: string;
let terminalRunId: string;
let terminalStageRunId: string;
let prId: string;

beforeAll(async () => {
  const orgSvc = createOrganizationService(db);
  const userSvc = createUserService(db);
  const projSvc = createProjectService(db);
  const catalogSvc = createIssueCatalogService(db);
  const issueSvc = createIssueService(db);

  const org = await orgSvc.create({
    name: `mc-${RUN}`,
    slug: `mc-${RUN}`,
    settings: {},
  });
  cleanup.push(async () => {
    await db
      .delete(schema.organization)
      .where(eq(schema.organization.id, org.id));
  });

  const usr = await userSvc.create({
    orgId: org.id,
    email: `mc-${RUN}@test.local`,
    name: `mc-${RUN}`,
    slug: `mc-${RUN}`,
  });
  cleanup.push(async () => {
    await db.delete(schema.user).where(eq(schema.user.id, usr.id));
  });

  const proj = await projSvc.create({
    orgId: org.id,
    userId: usr.id,
    name: `mc-proj-${RUN}`,
    slug: `mc-proj-${RUN}`,
  });
  cleanup.push(async () => {
    await db.delete(schema.project).where(eq(schema.project.id, proj.id));
  });
  projectId = proj.id;

  const proj2 = await projSvc.create({
    orgId: org.id,
    userId: usr.id,
    name: `mc-proj2-${RUN}`,
    slug: `mc-proj2-${RUN}`,
  });
  cleanup.push(async () => {
    await db.delete(schema.project).where(eq(schema.project.id, proj2.id));
  });
  secondProjectId = proj2.id;

  // Catalog
  const t = await catalogSvc.types.create({
    projectId,
    key: `feat-${RUN}`,
    displayName: 'Feature',
    color: '#00ff00',
    sortOrder: 1,
  });
  cleanup.push(async () => {
    await db.delete(schema.issueType).where(eq(schema.issueType.id, t.id));
  });

  const state = await catalogSvc.states.create({
    projectId,
    key: `open-${RUN}`,
    displayName: 'Open',
    color: '#22cc22',
    sortOrder: 1,
    isTerminal: false,
  });
  cleanup.push(async () => {
    await db
      .delete(schema.issueState)
      .where(eq(schema.issueState.id, state.id));
  });

  const status = await catalogSvc.statuses.create({
    projectId,
    key: `backlog-${RUN}`,
    displayName: 'Backlog',
    sortOrder: 1,
  });
  cleanup.push(async () => {
    await db
      .delete(schema.issueStatus)
      .where(eq(schema.issueStatus.id, status.id));
  });

  const priority = await catalogSvc.priorities.create({
    projectId,
    key: `high-${RUN}`,
    displayName: 'High',
    color: '#ff0000',
    weight: 100,
  });
  cleanup.push(async () => {
    await db
      .delete(schema.issuePriority)
      .where(eq(schema.issuePriority.id, priority.id));
  });

  const [config] = await db
    .insert(schema.configEntry)
    .values({
      scope: 'project',
      projectId,
      key: 'issues.status.on_create_key',
      value: `backlog-${RUN}`,
    })
    .returning();
  cleanup.push(async () => {
    await db
      .delete(schema.configEntry)
      .where(eq(schema.configEntry.id, config.id));
  });

  const iss = await issueSvc.create({
    projectId,
    title: 'mc test issue',
    typeId: t.id,
    priorityId: priority.id,
    author: 'mc-user',
  });
  cleanup.push(async () => {
    await db.delete(schema.issue).where(eq(schema.issue.id, iss.id));
  });
  issueId = iss.id;

  // Pipeline + stage
  const [pipe] = await db
    .insert(schema.pipeline)
    .values({ projectId, name: `mc-pipe-${RUN}` })
    .returning();
  cleanup.push(async () => {
    await db.delete(schema.pipeline).where(eq(schema.pipeline.id, pipe.id));
  });
  _pipelineId = pipe.id;

  const [stage] = await db
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
  cleanup.push(async () => {
    await db
      .delete(schema.pipelineStage)
      .where(eq(schema.pipelineStage.id, stage.id));
  });
  _stageId = stage.id;

  // Pending run
  const [pendingRun] = await db
    .insert(schema.pipelineRun)
    .values({
      pipelineId: pipe.id,
      issueId,
      status: PIPELINE_RUN_STATUS.pending,
    })
    .returning();
  cleanup.push(async () => {
    await db
      .delete(schema.pipelineRun)
      .where(eq(schema.pipelineRun.id, pendingRun.id));
  });
  pendingRunId = pendingRun.id;

  // Running run + launching stage_run
  const [runningRun] = await db
    .insert(schema.pipelineRun)
    .values({
      pipelineId: pipe.id,
      issueId,
      status: PIPELINE_RUN_STATUS.running,
      startedAt: new Date(),
    })
    .returning();
  cleanup.push(async () => {
    await db
      .delete(schema.pipelineRun)
      .where(eq(schema.pipelineRun.id, runningRun.id));
  });
  runningRunId = runningRun.id;

  const [runningSr] = await db
    .insert(schema.stageRun)
    .values({
      pipelineRunId: runningRun.id,
      pipelineStageId: stage.id,
      status: STAGE_RUN_STATUS.launching,
    })
    .returning();
  cleanup.push(async () => {
    await db
      .delete(schema.stageRun)
      .where(eq(schema.stageRun.id, runningSr.id));
  });
  runningStageRunId = runningSr.id;

  // Terminal run + completed stage_run
  const [terminalRun] = await db
    .insert(schema.pipelineRun)
    .values({
      pipelineId: pipe.id,
      issueId,
      status: PIPELINE_RUN_STATUS.completed,
      startedAt: new Date(Date.now() - 60_000),
      completedAt: new Date(),
    })
    .returning();
  cleanup.push(async () => {
    await db
      .delete(schema.pipelineRun)
      .where(eq(schema.pipelineRun.id, terminalRun.id));
  });
  terminalRunId = terminalRun.id;

  const [terminalSr] = await db
    .insert(schema.stageRun)
    .values({
      pipelineRunId: terminalRun.id,
      pipelineStageId: stage.id,
      status: STAGE_RUN_STATUS.completed,
      startedAt: new Date(Date.now() - 60_000),
      completedAt: new Date(),
    })
    .returning();
  cleanup.push(async () => {
    await db
      .delete(schema.stageRun)
      .where(eq(schema.stageRun.id, terminalSr.id));
  });
  terminalStageRunId = terminalSr.id;

  // PR row
  const [pr] = await db
    .insert(schema.issuePullRequest)
    .values({
      issueId,
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
  cleanup.push(async () => {
    await db
      .delete(schema.issuePullRequest)
      .where(eq(schema.issuePullRequest.id, pr.id));
  });
  prId = pr.id;
});

afterAll(async () => {
  for (const fn of cleanup.reverse()) {
    await fn().catch(() => {});
  }
  await provider.close();
});

describe('R-MISSION-CONTROL mission.summary', () => {
  const caller = appRouter.createCaller({ db });

  it('returns each section populated for the project', async () => {
    const out = await caller.mission.summary({ projectId });

    expect(out.pendingRuns.length).toBe(1);
    expect(out.pendingRuns[0]?.id).toBe(pendingRunId);
    expect(out.pendingRuns[0]?.pipelineName).toBe(`mc-pipe-${RUN}`);
    expect(out.pendingRuns[0]?.issueTitle).toBe('mc test issue');

    expect(out.runningRuns.length).toBe(1);
    expect(out.runningRuns[0]?.run.id).toBe(runningRunId);
    expect(out.runningRuns[0]?.currentStage?.id).toBe(runningStageRunId);
    expect(out.runningRuns[0]?.currentStage?.name).toBe('research');
    expect(out.runningRuns[0]?.currentStage?.status).toBe(
      STAGE_RUN_STATUS.launching
    );

    expect(out.recentTerminal.length).toBe(1);
    expect(out.recentTerminal[0]?.run.id).toBe(terminalRunId);
    expect(out.recentTerminal[0]?.finalStage?.id).toBe(terminalStageRunId);
    expect(out.recentTerminal[0]?.finalStage?.status).toBe(
      STAGE_RUN_STATUS.completed
    );

    expect(out.recentPullRequests.length).toBe(1);
    expect(out.recentPullRequests[0]?.id).toBe(prId);
    expect(out.recentPullRequests[0]?.prNumber).toBe(42);
    expect(out.recentPullRequests[0]?.issueTitle).toBe('mc test issue');
  });

  it('returns empty arrays for a project with no fixtures', async () => {
    const out = await caller.mission.summary({ projectId: secondProjectId });
    expect(out.pendingRuns).toEqual([]);
    expect(out.runningRuns).toEqual([]);
    expect(out.recentTerminal).toEqual([]);
    expect(out.recentPullRequests).toEqual([]);
  });
});
