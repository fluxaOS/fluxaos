/**
 * Pipeline Engine Demo — run from terminal to see the orchestrator work.
 *
 * Usage: npx tsx src/core/orchestrator/demo.ts
 *
 * Creates a pipeline run, then ticks the orchestrator through the full
 * lifecycle: queue → launch → execute → advance → complete.
 *
 * Uses a mock executor (echo) so no real AI provider is needed.
 */
import 'dotenv/config';
import { eq, and } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import {
  pipeline,
  pipelineStage,
  pipelineRun,
  stageRun,
  event,
  issue,
  issueState,
  issueStatus,
  issueType,
  issuePriority,
  provider,
  model,
  routingProfile,
  routingRule,
  project,
} from '@/core/db/schema';
import { createPipelineRunService } from './pipeline-run-service';
import { createOrchestratorManager } from './manager';
import { createStageJobHandler } from './stage-worker';
import type { QueueProvider, Job, JobOptions } from '@/core/ports/queue';
import type { StageExecutor, ExecuteParams, ExecuteResult } from '@/core/ports/stage-executor';
import type { StageJobPayload } from './types';

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DIRECT_URL or DATABASE_URL must be set.');
  process.exit(1);
}

const dbProvider = new SupabaseDatabaseProvider(url);
const db = dbProvider.getConnection();

// ─── Mock Queue + Executor ──────────────────────────────────────────────────

const jobQueue = new Map<string, Job<StageJobPayload>>();
let jobHandler: ((job: Job<StageJobPayload>) => Promise<void>) | null = null;

const mockQueue: QueueProvider = {
  async enqueue<T>(queueName: string, jobId: string, data: T): Promise<void> {
    jobQueue.set(jobId, {
      id: jobId,
      data: data as any,
      status: 'waiting',
      progress: 0,
      attempts: 0,
    });
  },
  process<T>(queueName: string, handler: (job: Job<T>) => Promise<void>): void {
    jobHandler = handler as any;
  },
  async getJob<T>(queueName: string, jobId: string): Promise<Job<T> | null> {
    return (jobQueue.get(jobId) as any) ?? null;
  },
  async cancelJob(queueName: string, jobId: string): Promise<void> {
    jobQueue.delete(jobId);
  },
};

const mockExecutor: StageExecutor = {
  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const output = `[mock] Executing: ${params.command} ${params.args.join(' ')}\n[mock] Model: ${params.env?.FLUXAOS_MODEL ?? 'unknown'}\n[mock] Done.\n`;
    params.onStdout?.(output);
    return {
      exitCode: 0,
      stdout: output,
      stderr: '',
      durationMs: 150,
      processId: 'demo-process',
    };
  },
  async cancel(): Promise<void> {},
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(icon: string, msg: string) {
  console.log(`  ${icon} ${msg}`);
}

async function processQueuedJobs() {
  if (!jobHandler) return 0;
  let processed = 0;
  for (const [id, job] of jobQueue) {
    await jobHandler(job);
    jobQueue.delete(id);
    processed++;
  }
  return processed;
}

// ─── Demo ───────────────────────────────────────────────────────────────────

async function demo() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  fluxaOS Pipeline Engine Demo');
  console.log('═══════════════════════════════════════════════════════\n');

  const runService = createPipelineRunService(db);

  // 1. Find the seeded pipeline and issue data
  const [pipe] = await db.select().from(pipeline).limit(1);
  if (!pipe) {
    console.error('No pipeline found. Run: npx tsx src/core/db/seed.ts');
    process.exit(1);
  }

  const stages = await runService.getStages(pipe.id);
  log('📋', `Pipeline: ${pipe.name} (${stages.length} stages)`);
  for (const s of stages) {
    log('  ', `${s.sortOrder}. ${s.name} — gate: ${s.gateMode}, harness: ${s.harness}`);
  }

  // Check for providers (routing needs at least one)
  const [proj] = await db.select().from(project).where(eq(project.id, pipe.projectId));
  const providers = await db.select().from(provider).where(eq(provider.orgId, proj.orgId));

  if (providers.length === 0) {
    console.log('\n  ⚠️  No providers configured. Creating a demo provider...\n');

    const [prov] = await db.insert(provider).values({
      orgId: proj.orgId, name: 'demo-provider', type: 'demo',
      baseUrl: null, apiKeyRef: null, isHealthy: true,
    }).returning();

    await db.insert(model).values({
      providerId: prov.id, name: 'demo-model', identifier: 'demo-model-v1',
      costPer1kInput: '0.003', costPer1kOutput: '0.015',
    });

    const [profile] = await db.insert(routingProfile).values({
      orgId: proj.orgId, name: 'demo-profile', isDefault: true,
    }).returning();

    await db.insert(routingRule).values({
      profileId: profile.id, stageName: null, sortStrategy: 'quality',
    });

    log('✓', 'Demo provider + model + routing created');
  }

  // Create a test issue if none exists
  let [iss] = await db.select().from(issue).where(eq(issue.projectId, pipe.projectId)).limit(1);
  if (!iss) {
    const [type] = await db.select().from(issueType).where(eq(issueType.projectId, pipe.projectId)).limit(1);
    const [state] = await db.select().from(issueState).where(eq(issueState.projectId, pipe.projectId)).limit(1);
    const [status] = await db.select().from(issueStatus).where(eq(issueStatus.projectId, pipe.projectId)).limit(1);
    const [priority] = await db.select().from(issuePriority).where(eq(issuePriority.projectId, pipe.projectId)).limit(1);

    [iss] = await db.insert(issue).values({
      projectId: pipe.projectId, number: 999, title: 'Demo Issue',
      stateId: state.id, statusId: status.id, typeId: type.id, priorityId: priority.id,
      author: 'demo',
    }).returning();
  }

  log('🎫', `Issue: #${iss.number} — ${iss.title}`);

  // 2. Create a pipeline run
  console.log('\n── Triggering Pipeline Run ─────────────────────────\n');
  const run = await runService.createRun(pipe.id, iss.id);
  log('🚀', `Pipeline run created: ${run.id} (status: ${run.status})`);

  // 3. Set up the worker — assign handler so processQueuedJobs can use it
  jobHandler = createStageJobHandler({
    db,
    executor: mockExecutor,
    onOutput: (_stageRunId, text) => {
      for (const line of text.trim().split('\n')) {
        log('  📤', line);
      }
    },
  });

  // 4. Orchestrator tick loop
  const manager = createOrchestratorManager(db, mockQueue, {
    maxConcurrentRuns: 5,
    maxConcurrentStages: 5,
  });

  console.log('\n── Orchestrator Loop ───────────────────────────────\n');

  // The loop simulates the real-world cycle:
  // 1. Orchestrator tick (launches stages, advances pipelines)
  // 2. Worker processes queued jobs (executes stages)
  // 3. Repeat until pipeline is terminal
  for (let tick = 1; tick <= (stages.length * 2) + 2; tick++) {
    log('⏱️', `Tick ${tick}...`);

    // First: process any queued jobs from the PREVIOUS tick
    // (In production, the BullMQ worker does this continuously)
    const processed = await processQueuedJobs();
    if (processed > 0) {
      log('⚡', `Worker processed ${processed} job(s)`);
    }

    // Then: orchestrator tick (picks up queued runs, advances completed stages)
    const result = await manager.tick();

    if (result.launched > 0) log('🟢', `Launched ${result.launched} stage(s)`);
    if (result.advanced > 0) log('🔄', `Advanced ${result.advanced} pipeline(s)`);
    if (result.completed > 0) log('🏁', `Completed ${result.completed} pipeline(s)`);
    if (result.errors.length > 0) {
      for (const err of result.errors) log('❌', err);
    }

    // Check if pipeline is done
    const current = await runService.getRun(run.id);
    if (current && ['completed', 'failed', 'cancelled', 'timed_out'].includes(current.status)) {
      log('✅', `Pipeline finished: ${current.status}`);
      break;
    }
  }

  // 5. Show final state
  console.log('\n── Final State ─────────────────────────────────────\n');

  const finalRun = await runService.getRun(run.id);
  log('📊', `Pipeline run: ${finalRun?.status} (cost: $${finalRun?.totalCostUsd})`);

  const finalStageRuns = await runService.getStageRuns(run.id);
  for (const sr of finalStageRuns) {
    const [stageDef] = await db.select().from(pipelineStage)
      .where(eq(pipelineStage.id, sr.pipelineStageId));

    const events = await db.select().from(event)
      .where(eq(event.stageRunId, sr.id));

    log('  ', `${stageDef?.name ?? '?'}: ${sr.status} (${events.length} events, provider: ${sr.provider ?? 'n/a'}, model: ${sr.model ?? 'n/a'})`);
  }

  // Cleanup demo data
  console.log('\n── Cleanup ─────────────────────────────────────────\n');
  for (const sr of finalStageRuns) {
    await db.delete(event).where(eq(event.stageRunId, sr.id)).catch(() => {});
    const { stageGateResult } = await import('@/core/db/schema');
    await db.delete(stageGateResult).where(eq(stageGateResult.stageRunId, sr.id)).catch(() => {});
    await db.delete(stageRun).where(eq(stageRun.id, sr.id)).catch(() => {});
  }
  await db.delete(pipelineRun).where(eq(pipelineRun.id, run.id)).catch(() => {});
  log('🧹', 'Demo data cleaned up');

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Demo complete.');
  console.log('═══════════════════════════════════════════════════════\n');
  process.exit(0);
}

demo().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
