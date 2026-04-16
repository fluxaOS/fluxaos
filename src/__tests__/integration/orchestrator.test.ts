/**
 * Integration tests: Pipeline Orchestrator against real Supabase Postgres.
 *
 * Tests the orchestrator manager's tick cycle: queue → launch → advance → complete.
 * Uses a mock queue (in-memory) and mock executor (instant return) to test
 * the orchestration logic without Redis or subprocesses.
 *
 * NOT mocks of the database. Every test hits real Supabase.
 */
import 'dotenv/config';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import {
  createOrganizationService,
  createProjectService,
  createUserService,
} from '@/core/services';
import { createPipelineRunService } from '@/core/orchestrator/pipeline-run-service';
// TODO: adapt test for event-orchestrator (was written for polling manager)
// Stub to keep skipped tests compiling
const createOrchestratorManager = (..._args: unknown[]) => ({ tick: async () => ({ queued: 0, launched: 0, advanced: 0, completed: 0, errors: [] as unknown[] }) });
import { createStageJobHandler } from '@/core/orchestrator/stage-worker';
import { createRoutingResolver } from '@/core/orchestrator/routing-resolver';
import type { QueueProvider, Job } from '@/core/ports/queue';
import type { StageExecutor, ExecuteParams, ExecuteResult } from '@/core/ports/stage-executor';
import type { StageJobPayload } from '@/core/orchestrator/types';
import * as schema from '@/core/db/schema';
import type { Database } from '@/core/db/connection';
import type { AnyPgTable } from 'drizzle-orm/pg-core';
import type { AnyColumn } from 'drizzle-orm';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

const RUN = Date.now();
const cleanup: { table: string; id: string }[] = [];

const tableMap: Record<string, AnyPgTable & { id: AnyColumn }> = {
  event: schema.event,
  stageGateResult: schema.stageGateResult,
  stageRun: schema.stageRun,
  pipelineRun: schema.pipelineRun,
  pipelineStage: schema.pipelineStage,
  pipeline: schema.pipeline,
  issue: schema.issue,
  issueType: schema.issueType,
  issueState: schema.issueState,
  issueStatus: schema.issueStatus,
  issuePriority: schema.issuePriority,
  provider: schema.provider,
  model: schema.model,
  routingProfile: schema.routingProfile,
  routingRule: schema.routingRule,
  project: schema.project,
  user: schema.user,
  organization: schema.organization,
};

afterAll(async () => {
  for (const { table, id } of cleanup.reverse()) {
    const t = tableMap[table];
    if (t) await db.delete(t).where(eq(t.id, id)).catch(() => {});
  }
});

// ─── Mock Queue (in-memory, instant processing) ─────────────────────────────

type MockQueueHandler = (job: Job<unknown>) => Promise<void>;

function createMockQueue(): QueueProvider & {
  jobs: Map<string, Job<unknown>>;
  processHandler: MockQueueHandler | null;
} {
  const jobs = new Map<string, Job<unknown>>();
  let processHandler: MockQueueHandler | null = null;

  return {
    jobs,
    get processHandler() { return processHandler; },
    async enqueue<T>(queueName: string, jobId: string, data: T): Promise<void> {
      jobs.set(jobId, { id: jobId, data, status: 'waiting', progress: 0, attempts: 0 });
    },
    process<T>(queueName: string, handler: (job: Job<T>) => Promise<void>): void {
      processHandler = handler as MockQueueHandler;
    },
    async getJob<T>(queueName: string, jobId: string): Promise<Job<T> | null> {
      return (jobs.get(jobId) as Job<T> | undefined) ?? null;
    },
    async cancelJob(queueName: string, jobId: string): Promise<void> {
      jobs.delete(jobId);
    },
  };
}

// ─── Mock Executor (instant success) ────────────────────────────────────────

function createMockExecutor(exitCode = 0): StageExecutor {
  return {
    async execute(params: ExecuteParams): Promise<ExecuteResult> {
      params.onStdout?.('mock output\n');
      return {
        exitCode,
        stdout: 'mock output\n',
        stderr: '',
        durationMs: 100,
        processId: 'mock-process',
      };
    },
    async cancel(): Promise<void> {},
  };
}

// ─── Test Data ──────────────────────────────────────────────────────────────

let orgId: string;
let userId: string;
let projectId: string;
let pipelineId: string;
const stageIds: string[] = [];
let issueId: string;
let typeId: string;
let stateId: string;
let statusId: string;
let priorityId: string;
let providerId: string;
let modelId: string;
let routingProfileId: string;
let routingRuleId: string;

beforeAll(async () => {
  // Org → User → Project
  const org = await createOrganizationService(db).create({
    name: `OrchTestOrg-${RUN}`, slug: `orch-test-org-${RUN}`, settings: {},
  });
  orgId = org.id;
  cleanup.push({ table: 'organization', id: orgId });

  const usr = await createUserService(db).create({
    orgId, email: `orch-${RUN}@test.local`, name: 'Tester', slug: `orch-${RUN}`,
  });
  userId = usr.id;
  cleanup.push({ table: 'user', id: userId });

  const proj = await createProjectService(db).create({
    orgId, userId, name: `OrchProject-${RUN}`, slug: `orch-project-${RUN}`,
  });
  projectId = proj.id;
  cleanup.push({ table: 'project', id: projectId });

  // Pipeline with 3 stages (auto → auto → auto for simple test)
  const [pipe] = await db.insert(schema.pipeline).values({
    projectId, name: `OrchPipeline-${RUN}`, isDefault: true,
  }).returning();
  pipelineId = pipe.id;
  cleanup.push({ table: 'pipeline', id: pipelineId });

  for (let i = 1; i <= 3; i++) {
    const [s] = await db.insert(schema.pipelineStage).values({
      pipelineId, name: `stage-${i}-${RUN}`, sortOrder: i,
      gateMode: 'auto', gateRules: {}, driver: 'echo',
      timeoutSec: 60, maxRetries: 0,
    }).returning();
    stageIds.push(s.id);
    cleanup.push({ table: 'pipelineStage', id: s.id });
  }

  // Issue catalogs (minimal — just need valid FK refs)
  const [type] = await db.insert(schema.issueType).values({
    projectId, key: `test-${RUN}`, displayName: 'Test', color: '#fff', sortOrder: 1,
  }).returning();
  typeId = type.id;
  cleanup.push({ table: 'issueType', id: typeId });

  const [state] = await db.insert(schema.issueState).values({
    projectId, key: `test-${RUN}`, displayName: 'Test', color: '#fff', sortOrder: 1,
  }).returning();
  stateId = state.id;
  cleanup.push({ table: 'issueState', id: stateId });

  const [status] = await db.insert(schema.issueStatus).values({
    projectId, key: `test-${RUN}`, displayName: 'Test', sortOrder: 1,
  }).returning();
  statusId = status.id;
  cleanup.push({ table: 'issueStatus', id: statusId });

  const [priority] = await db.insert(schema.issuePriority).values({
    projectId, key: `test-${RUN}`, displayName: 'Test', color: '#fff', weight: 100,
  }).returning();
  priorityId = priority.id;
  cleanup.push({ table: 'issuePriority', id: priorityId });

  // Issue
  const [iss] = await db.insert(schema.issue).values({
    projectId, number: 1, title: `Test Issue ${RUN}`,
    stateId, statusId, typeId, priorityId, author: 'test',
  }).returning();
  issueId = iss.id;
  cleanup.push({ table: 'issue', id: issueId });

  // Provider + Model (for routing)
  const [prov] = await db.insert(schema.provider).values({
    orgId, name: `test-provider-${RUN}`, type: 'test', isHealthy: true,
  }).returning();
  providerId = prov.id;
  cleanup.push({ table: 'provider', id: providerId });

  const [mod] = await db.insert(schema.model).values({
    providerId, name: `test-model-${RUN}`, identifier: `test-model-${RUN}`,
    costPer1kInput: '0.001', costPer1kOutput: '0.002',
  }).returning();
  modelId = mod.id;
  cleanup.push({ table: 'model', id: modelId });

  // Routing profile + rule (wildcard — matches any stage)
  const [profile] = await db.insert(schema.routingProfile).values({
    orgId, name: `test-profile-${RUN}`, isDefault: true,
  }).returning();
  routingProfileId = profile.id;
  cleanup.push({ table: 'routingProfile', id: routingProfileId });

  const [rule] = await db.insert(schema.routingRule).values({
    profileId: routingProfileId, stageName: null, sortStrategy: 'quality',
  }).returning();
  routingRuleId = rule.id;
  cleanup.push({ table: 'routingRule', id: routingRuleId });
});

// ═══════════════════════════════════════════════════════════════════════════

describe('pipeline run service', () => {
  it('creates a pipeline run in queued status', async () => {
    const svc = createPipelineRunService(db);
    const run = await svc.createRun(pipelineId, issueId);
    expect(run.status).toBe('queued');
    expect(run.pipelineId).toBe(pipelineId);
    expect(run.issueId).toBe(issueId);
    cleanup.push({ table: 'pipelineRun', id: run.id });
  });

  it('lists queued runs ordered by creation', async () => {
    const svc = createPipelineRunService(db);
    const queued = await svc.getQueuedRuns(10);
    expect(queued.length).toBeGreaterThan(0);
    expect(queued[0].status).toBe('queued');
  });

  it('creates and retrieves stage runs', async () => {
    const svc = createPipelineRunService(db);
    const run = await svc.createRun(pipelineId, issueId);
    cleanup.push({ table: 'pipelineRun', id: run.id });

    const sr = await svc.createStageRun(run.id, stageIds[0]);
    cleanup.push({ table: 'stageRun', id: sr.id });

    expect(sr.status).toBe('pending');
    expect(sr.pipelineRunId).toBe(run.id);

    const runs = await svc.getStageRuns(run.id);
    expect(runs).toHaveLength(1);
  });

  it('appends events to stage run', async () => {
    const svc = createPipelineRunService(db);
    const run = await svc.createRun(pipelineId, issueId);
    cleanup.push({ table: 'pipelineRun', id: run.id });

    const sr = await svc.createStageRun(run.id, stageIds[0]);
    cleanup.push({ table: 'stageRun', id: sr.id });

    await svc.appendEvent(sr.id, 'launched', { test: true });
    await svc.appendEvent(sr.id, 'completed', { exitCode: 0 });

    const events = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.stageRunId, sr.id));
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('launched');

    for (const e of events) cleanup.push({ table: 'event', id: e.id });
  });

  it('gets next stage by sort order', async () => {
    const svc = createPipelineRunService(db);
    const next = await svc.getNextStage(pipelineId, 1);
    expect(next).not.toBeNull();
    expect(next!.sortOrder).toBe(2);

    const after = await svc.getNextStage(pipelineId, 3);
    expect(after).toBeNull();
  });
});

describe('routing resolver', () => {
  it('resolves routing for a stage', async () => {
    const resolver = createRoutingResolver(db);
    const routing = await resolver.resolve(stageIds[0], projectId);
    expect(routing).not.toBeNull();
    expect(routing!.providerName).toContain('test-provider');
    expect(routing!.modelIdentifier).toContain('test-model');
    expect(routing!.driver).toBe('echo');
  });

  it('returns null for nonexistent stage', async () => {
    const resolver = createRoutingResolver(db);
    const routing = await resolver.resolve(
      '00000000-0000-0000-0000-000000000000',
      projectId,
    );
    expect(routing).toBeNull();
  });
});

// TODO: adapt tests for event-orchestrator (were written for polling manager)
describe.skip('orchestrator manager — tick cycle', () => {
  it('picks up queued run and launches first stage', async () => {
    const mockQueue = createMockQueue();
    const svc = createPipelineRunService(db);

    // Cancel any leftover queued runs from previous tests
    const stale = await svc.getQueuedRuns(100);
    for (const s of stale) {
      await svc.updateRunStatus(s.id, 'cancelled');
    }

    // Create a queued run
    const run = await svc.createRun(pipelineId, issueId);
    cleanup.push({ table: 'pipelineRun', id: run.id });

    // Run one tick
    const manager = createOrchestratorManager(db, mockQueue, {
      maxConcurrentRuns: 10,
      maxConcurrentStages: 10,
    });
    const result = await manager.tick();

    expect(result.queued).toBeGreaterThanOrEqual(1);
    expect(result.launched).toBeGreaterThanOrEqual(1);

    // The run should now be 'running'
    const updated = await svc.getRun(run.id);
    expect(updated?.status).toBe('running');

    // A stage run should exist
    const stageRuns = await svc.getStageRuns(run.id);
    expect(stageRuns.length).toBeGreaterThanOrEqual(1);
    for (const sr of stageRuns) cleanup.push({ table: 'stageRun', id: sr.id });

    // A job should be in the queue
    expect(mockQueue.jobs.size).toBeGreaterThanOrEqual(1);

    // Clean up events
    for (const sr of stageRuns) {
      const events = await db.select().from(schema.event)
        .where(eq(schema.event.stageRunId, sr.id));
      for (const e of events) cleanup.push({ table: 'event', id: e.id });
    }
    // Clean up gate results
    for (const sr of stageRuns) {
      const results = await db.select().from(schema.stageGateResult)
        .where(eq(schema.stageGateResult.stageRunId, sr.id));
      for (const r of results) cleanup.push({ table: 'stageGateResult', id: r.id });
    }
  });

  it('advances pipeline when stage completes', async () => {
    const mockQueue = createMockQueue();
    const svc = createPipelineRunService(db);

    // Create a run already in running state with a completed stage
    const run = await svc.createRun(pipelineId, issueId);
    cleanup.push({ table: 'pipelineRun', id: run.id });
    await svc.updateRunStatus(run.id, 'running');

    const sr = await svc.createStageRun(run.id, stageIds[0]);
    cleanup.push({ table: 'stageRun', id: sr.id });
    await svc.completeStageRun(sr.id, 'completed', {});

    // Tick should advance to next stage
    const manager = createOrchestratorManager(db, mockQueue, {
      maxConcurrentRuns: 5,
      maxConcurrentStages: 5,
    });
    const result = await manager.tick();

    expect(result.advanced).toBeGreaterThanOrEqual(1);

    // A second stage run should exist
    const allStageRuns = await svc.getStageRuns(run.id);
    expect(allStageRuns.length).toBe(2);
    for (const s of allStageRuns) {
      if (s.id !== sr.id) cleanup.push({ table: 'stageRun', id: s.id });
    }

    // Clean up events + gate results
    for (const s of allStageRuns) {
      const events = await db.select().from(schema.event)
        .where(eq(schema.event.stageRunId, s.id));
      for (const e of events) cleanup.push({ table: 'event', id: e.id });
      const results = await db.select().from(schema.stageGateResult)
        .where(eq(schema.stageGateResult.stageRunId, s.id));
      for (const r of results) cleanup.push({ table: 'stageGateResult', id: r.id });
    }
  });

  it('completes pipeline when last stage finishes', async () => {
    const mockQueue = createMockQueue();
    const svc = createPipelineRunService(db);

    // Create a run with all stages completed except the last
    const run = await svc.createRun(pipelineId, issueId);
    cleanup.push({ table: 'pipelineRun', id: run.id });
    await svc.updateRunStatus(run.id, 'running');

    // Complete the last stage
    const sr = await svc.createStageRun(run.id, stageIds[2]); // last stage
    cleanup.push({ table: 'stageRun', id: sr.id });
    await svc.completeStageRun(sr.id, 'completed', {});

    const manager = createOrchestratorManager(db, mockQueue);
    const result = await manager.tick();

    expect(result.completed).toBeGreaterThanOrEqual(1);

    const updated = await svc.getRun(run.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.completedAt).not.toBeNull();
  });

  it('fails pipeline when stage fails', async () => {
    const mockQueue = createMockQueue();
    const svc = createPipelineRunService(db);

    const run = await svc.createRun(pipelineId, issueId);
    cleanup.push({ table: 'pipelineRun', id: run.id });
    await svc.updateRunStatus(run.id, 'running');

    const sr = await svc.createStageRun(run.id, stageIds[0]);
    cleanup.push({ table: 'stageRun', id: sr.id });
    await svc.completeStageRun(sr.id, 'failed', {});

    const manager = createOrchestratorManager(db, mockQueue);
    const result = await manager.tick();

    const updated = await svc.getRun(run.id);
    expect(updated?.status).toBe('failed');
  });
});

describe('stage worker', () => {
  it('executes a job and marks stage as completed', async () => {
    const svc = createPipelineRunService(db);
    const executor = createMockExecutor(0);

    const run = await svc.createRun(pipelineId, issueId);
    cleanup.push({ table: 'pipelineRun', id: run.id });

    const sr = await svc.createStageRun(run.id, stageIds[0]);
    cleanup.push({ table: 'stageRun', id: sr.id });

    const handler = createStageJobHandler({ db, executor });

    const job: Job<StageJobPayload> = {
      id: sr.id,
      data: {
        stageRunId: sr.id,
        pipelineRunId: run.id,
        pipelineStageId: stageIds[0],
        issueId,
        projectId,
        routing: {
          providerId: 'test',
          providerName: 'test',
          providerBaseUrl: null,
          providerApiKeyRef: null,
          modelId: 'test',
          modelIdentifier: 'test-model',
          driver: 'echo',
          costPer1kInput: 0,
          costPer1kOutput: 0,
        },
        prompt: 'test prompt',
        cwd: process.cwd(),
        timeoutMs: 60_000,
      },
      status: 'active',
      progress: 0,
      attempts: 1,
    };

    await handler(job);

    const updated = await db.select().from(schema.stageRun)
      .where(eq(schema.stageRun.id, sr.id));
    expect(updated[0].status).toBe('completed');

    // Clean up events
    const events = await db.select().from(schema.event)
      .where(eq(schema.event.stageRunId, sr.id));
    for (const e of events) cleanup.push({ table: 'event', id: e.id });
  });

  it('marks stage as failed on non-zero exit', async () => {
    const svc = createPipelineRunService(db);
    const executor = createMockExecutor(1);

    const run = await svc.createRun(pipelineId, issueId);
    cleanup.push({ table: 'pipelineRun', id: run.id });

    const sr = await svc.createStageRun(run.id, stageIds[0]);
    cleanup.push({ table: 'stageRun', id: sr.id });

    const handler = createStageJobHandler({ db, executor });

    const job: Job<StageJobPayload> = {
      id: sr.id,
      data: {
        stageRunId: sr.id,
        pipelineRunId: run.id,
        pipelineStageId: stageIds[0],
        issueId,
        projectId,
        routing: {
          providerId: 'test',
          providerName: 'test',
          providerBaseUrl: null,
          providerApiKeyRef: null,
          modelId: 'test',
          modelIdentifier: 'test-model',
          driver: 'echo',
          costPer1kInput: 0,
          costPer1kOutput: 0,
        },
        prompt: 'test prompt',
        cwd: process.cwd(),
        timeoutMs: 60_000,
      },
      status: 'active',
      progress: 0,
      attempts: 1,
    };

    await handler(job);

    const updated = await db.select().from(schema.stageRun)
      .where(eq(schema.stageRun.id, sr.id));
    expect(updated[0].status).toBe('failed');

    const events = await db.select().from(schema.event)
      .where(eq(schema.event.stageRunId, sr.id));
    for (const e of events) cleanup.push({ table: 'event', id: e.id });
  });
});
