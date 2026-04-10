/**
 * Pipeline Orchestrator Manager — the brain of fluxaOS.
 *
 * Runs on a heartbeat interval. Each tick:
 * 1. Pick up queued pipeline runs
 * 2. For each: launch the first stage (evaluate gates, resolve routing, enqueue)
 * 3. Check running pipeline runs for stage completion
 * 4. On completion: advance to next stage or finish the pipeline
 * 5. Check for timeouts
 *
 * The manager is the ONLY actor that manages pipeline state.
 * AI workers are dumb executors — they don't make decisions.
 *
 * No hardcoded stage names. No hardcoded provider names.
 * Everything comes from the database.
 */
import type { Database } from '@/core/db/connection';
import type { QueueProvider } from '@/core/ports/queue';
import { createPipelineRunService } from './pipeline-run-service';
import { createRoutingResolver } from './routing-resolver';
import { createGateService } from '@/core/gates/service';
import type { GateMode, RuleGroup } from '@/core/gates/types';
import type {
  OrchestratorConfig,
  StageJobPayload,
} from './types';
import { DEFAULT_ORCHESTRATOR_CONFIG, STAGE_RUN_TERMINAL } from './types';
import { eq } from 'drizzle-orm';
import { pipelineStage, pipelineRun, issue } from '@/core/db/schema';

export interface OrchestratorManager {
  /** Start the heartbeat loop. */
  start(): void;
  /** Stop the heartbeat loop gracefully. */
  stop(): void;
  /** Run a single tick (for testing). */
  tick(): Promise<TickResult>;
  /** Whether the manager is running. */
  readonly running: boolean;
}

export interface TickResult {
  queued: number;
  launched: number;
  advanced: number;
  completed: number;
  errors: string[];
}

export function createOrchestratorManager(
  db: Database,
  queue: QueueProvider,
  config: Partial<OrchestratorConfig> = {},
): OrchestratorManager {
  const cfg = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
  const runService = createPipelineRunService(db);
  const routingResolver = createRoutingResolver(db);
  const gateService = createGateService(db);

  let interval: ReturnType<typeof setInterval> | null = null;
  let isRunning = false;
  let tickInProgress = false;

  async function tick(): Promise<TickResult> {
    if (tickInProgress) return { queued: 0, launched: 0, advanced: 0, completed: 0, errors: [] };
    tickInProgress = true;

    const result: TickResult = { queued: 0, launched: 0, advanced: 0, completed: 0, errors: [] };

    try {
      // ── Phase 1: Launch queued pipeline runs ─────────────────────────
      const runningRuns = await runService.getRunningRuns();
      const slotsAvailable = cfg.maxConcurrentRuns - runningRuns.length;

      if (slotsAvailable > 0) {
        const queuedRuns = await runService.getQueuedRuns(slotsAvailable);
        result.queued = queuedRuns.length;

        for (const run of queuedRuns) {
          try {
            await launchPipeline(run.id, run.pipelineId, run.issueId);
            result.launched++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result.errors.push(`launch ${run.id}: ${msg}`);
          }
        }
      }

      // ── Phase 2: Advance running pipeline runs ──────────────────────
      const allRunning = await runService.getRunningRuns();
      for (const run of allRunning) {
        try {
          const advanced = await advancePipeline(run.id, run.pipelineId, run.issueId);
          if (advanced === 'advanced') result.advanced++;
          if (advanced === 'completed') result.completed++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`advance ${run.id}: ${msg}`);
        }
      }
    } finally {
      tickInProgress = false;
    }

    return result;
  }

  async function launchPipeline(
    runId: string,
    pipelineId: string,
    issueId: string | null,
  ): Promise<void> {
    // Get the first stage
    const stages = await runService.getStages(pipelineId);
    if (stages.length === 0) {
      await runService.updateRunStatus(runId, 'failed');
      return;
    }

    // Mark pipeline as running
    await runService.updateRunStatus(runId, 'running');

    // Launch first stage
    await launchStage(runId, stages[0], issueId);
  }

  async function launchStage(
    runId: string,
    stage: typeof pipelineStage.$inferSelect,
    issueId: string | null,
  ): Promise<void> {
    // 1. Create stage run
    const sRun = await runService.createStageRun(runId, stage.id);

    // 2. Evaluate gates
    const gateMode = (stage.gateMode ?? 'auto') as GateMode;

    if (gateMode === 'skip') {
      // Skip this stage entirely — mark completed and advance
      await runService.completeStageRun(sRun.id, 'completed', {});
      await runService.appendEvent(sRun.id, 'completed', { skipped: true });
      return;
    }

    if (gateMode === 'hold' || gateMode === 'manual') {
      // Hold — mark as pending, wait for manual release
      await runService.updateStageRunStatus(sRun.id, 'pending');
      await runService.appendEvent(sRun.id, 'gate_checked', {
        verdict: 'hold',
        reason: `gate mode: ${gateMode}`,
      });
      return;
    }

    if (gateMode === 'rules') {
      // Build gate context from previous stage's results
      const prevStageRuns = await runService.getStageRuns(runId);
      const completedPrev = prevStageRuns
        .filter((s) => s.id !== sRun.id && STAGE_RUN_TERMINAL.has(s.status))
        .pop();

      const gateContext: Record<string, unknown> = {};
      if (completedPrev) {
        gateContext.exit_code = completedPrev.status === 'completed' ? 0 : 1;
        gateContext.cost_usd = Number(completedPrev.costUsd ?? 0);
        gateContext.tokens_in = completedPrev.tokensIn ?? 0;
        gateContext.tokens_out = completedPrev.tokensOut ?? 0;
        gateContext.provider = completedPrev.provider;
        gateContext.model = completedPrev.model;
        gateContext.harness = completedPrev.harness;
      }

      const gateResult = await gateService.evaluateStageGate(
        stage.id,
        sRun.id,
        gateContext,
      );

      if (!gateResult.passed) {
        // Gate failed — hold the stage
        await runService.updateStageRunStatus(sRun.id, 'pending');
        await runService.appendEvent(sRun.id, 'gate_checked', {
          verdict: gateResult.verdict,
          reason: gateResult.reason,
        });
        // If verdict is 'abort', fail the entire pipeline
        if (gateResult.verdict === 'abort') {
          await runService.completeRun(runId, 'failed');
        }
        return;
      }
    }

    // 3. Resolve routing
    // Get project ID from the pipeline run's issue
    let projectId: string | null = null;
    if (issueId) {
      const [iss] = await db
        .select({ projectId: issue.projectId })
        .from(issue)
        .where(eq(issue.id, issueId));
      projectId = iss?.projectId ?? null;
    }

    if (!projectId) {
      // Fall back: get project from pipeline
      const [pRun] = await db
        .select({ pipelineId: pipelineRun.pipelineId })
        .from(pipelineRun)
        .where(eq(pipelineRun.id, runId));

      if (pRun) {
        const { pipeline: pipelineTable } = await import('@/core/db/schema');
        const [pipe] = await db
          .select({ projectId: pipelineTable.projectId })
          .from(pipelineTable)
          .where(eq(pipelineTable.id, pRun.pipelineId));
        projectId = pipe?.projectId ?? null;
      }
    }

    const routing = projectId
      ? await routingResolver.resolve(stage.id, projectId)
      : null;

    if (!routing) {
      // No routing available — can't execute
      await runService.completeStageRun(sRun.id, 'failed', {});
      await runService.appendEvent(sRun.id, 'error', {
        error: 'no routing available — no providers configured',
      });
      return;
    }

    // 4. Mark as launching
    await runService.updateStageRunStatus(sRun.id, 'launching');

    // 5. Enqueue to BullMQ
    const jobPayload: StageJobPayload = {
      stageRunId: sRun.id,
      pipelineRunId: runId,
      pipelineStageId: stage.id,
      issueId: issueId ?? '',
      projectId: projectId ?? '',
      routing,
      prompt: '', // TODO: build from issue + skill + persona
      cwd: process.cwd(),
      timeoutMs: (stage.timeoutSec ?? 300) * 1000,
    };

    await queue.enqueue(cfg.queueName, sRun.id, jobPayload);
  }

  async function advancePipeline(
    runId: string,
    pipelineId: string,
    issueId: string | null,
  ): Promise<'running' | 'advanced' | 'completed'> {
    const stageRuns = await runService.getStageRuns(runId);
    if (stageRuns.length === 0) return 'running';

    const latestStageRun = stageRuns[stageRuns.length - 1];

    // Still running — nothing to do
    if (!STAGE_RUN_TERMINAL.has(latestStageRun.status)) {
      return 'running';
    }

    // Stage completed — find and launch next stage
    if (latestStageRun.status === 'completed') {
      // Get the stage definition to find sortOrder
      const [stageDef] = await db
        .select({ sortOrder: pipelineStage.sortOrder })
        .from(pipelineStage)
        .where(eq(pipelineStage.id, latestStageRun.pipelineStageId));

      if (!stageDef) {
        await runService.completeRun(runId, 'failed');
        return 'completed';
      }

      const nextStage = await runService.getNextStage(
        pipelineId,
        stageDef.sortOrder,
      );

      if (!nextStage) {
        // No more stages — pipeline is done
        await runService.completeRun(runId, 'completed');
        return 'completed';
      }

      // Launch next stage
      await launchStage(runId, nextStage, issueId);
      return 'advanced';
    }

    // Stage failed/timed_out/cancelled — pipeline fails
    const failStatus =
      latestStageRun.status === 'timed_out' ? 'timed_out' :
      latestStageRun.status === 'cancelled' ? 'cancelled' :
      'failed';
    await runService.completeRun(runId, failStatus);
    return 'completed';
  }

  return {
    start() {
      if (isRunning) return;
      isRunning = true;
      interval = setInterval(() => {
        tick().catch((err) => {
          console.error('[orchestrator] tick error:', err);
        });
      }, cfg.heartbeatIntervalMs);
    },

    stop() {
      isRunning = false;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    },

    tick,

    get running() {
      return isRunning;
    },
  };
}
