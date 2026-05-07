/**
 * Event-Driven Orchestrator — the systemd-managed pipeline state machine.
 *
 * Subscribes to Realtime for pipeline_run and stage_run changes.
 * Reads all config from DB. Writes all state via PipelineRunService.
 * The driver never touches the database.
 *
 * State machine:
 *   pipeline_run created → read first stage → create stage_run
 *   stage_run queued → executeStageRun → running → completed/failed
 *   stage_run completed → evaluate gate → verdict determines next state
 *   stage_run failed → check retry budget → retry or fail permanently
 *   all stages done → complete pipeline_run → write issue events
 */
import { eq } from 'drizzle-orm';
import type { FluxaosConfig } from '@/config/env';
import {
  EVENT_TYPE,
  PIPELINE_RUN_STATUS,
  STAGE_RUN_STATUS,
} from '@/core/constants';
import type { Database } from '@/core/db/connection';
import { type pipelineRun, pipelineStage, stageRun } from '@/core/db/schema';
import type { Unsubscribe } from '@/core/ports/auth';
import type { GitOpsPort } from '@/core/ports/git';
import type { IsolationProvider } from '@/core/ports/isolation';
import type { RealtimeProvider } from '@/core/ports/realtime';
import type { StageGraphRunner } from '@/core/ports/stage-graph-runner';
import { createPipelineRunService } from './pipeline-run-service';
import type { PipelineTerminalHook } from './pipeline-terminal-hook';
import { resolveProjectIdForRun } from './run-helpers';
import { createStageExecutor } from './stage-executor';

/**
 * Shape of a pipeline_run row as delivered by Supabase Realtime.
 * Realtime sends DB column names (snake_case), not Drizzle field names.
 */
interface PipelineRunRealtimeRow {
  id: string;
  pipeline_id: string;
  issue_id: string | null;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  total_cost_usd: string | null;
  artifacts_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventOrchestratorConfig {
  maxConcurrentRuns: number;
}

const DEFAULT_CONFIG: EventOrchestratorConfig = {
  maxConcurrentRuns: 5,
};

export interface EventOrchestrator {
  start(): void;
  stop(): void;
  recoverOnStartup(): Promise<void>;
  readonly running: boolean;
}

export interface EventOrchestratorDeps {
  isolation: IsolationProvider;
  gitOps: GitOpsPort;
}

export function createEventOrchestrator(
  db: Database,
  realtime: RealtimeProvider,
  terminalHook: PipelineTerminalHook,
  deps: EventOrchestratorDeps,
  config: Partial<EventOrchestratorConfig> = {},
  fluxaosConfig?: FluxaosConfig,
  stageGraphRunner?: StageGraphRunner
): EventOrchestrator {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const runService = createPipelineRunService(db);

  /**
   * Tracks runs currently being processed by handleNewRun.
   * Prevents concurrent double-processing of the same run when Realtime
   * delivers duplicate events or drainPending races with an INSERT event.
   */
  const inFlight = new Set<string>();

  const { launchStage } = createStageExecutor({
    db,
    runService,
    fluxaosConfig,
    stageGraphRunner,
    isolation: deps.isolation,
    gitOps: deps.gitOps,
    finishRun,
  });

  /**
   * Mark a pipeline_run terminal AND trigger the T16 hook (deploy on
   * completed, env-release on everything else). Centralized so every code
   * path that flips the run's status goes through the same hook.
   *
   * After the run reaches terminal state, drainPending() is called so any
   * pending runs waiting for a concurrency slot are picked up immediately.
   */
  async function finishRun(
    run: typeof pipelineRun.$inferSelect,
    status: (typeof PIPELINE_RUN_STATUS)[keyof typeof PIPELINE_RUN_STATUS]
  ): Promise<void> {
    await runService.completeRun(run.id, status);

    const projectId = await resolveProjectIdForRun(db, run.id);

    await terminalHook.onTerminal({
      runId: run.id,
      projectId,
      status,
    });

    // Vacated concurrency slot — drain the pending queue.
    drainPending().catch(logError('drainPending'));
  }

  let unsubscribeInsert: Unsubscribe | null = null;
  let unsubscribeUpdate: Unsubscribe | null = null;
  let isRunning = false;

  // ─── Realtime Subscription ──────────────────────────────────────────

  function start(): void {
    if (isRunning) return;
    isRunning = true;

    // Single-tenant assumption: processes all pipeline_run INSERTs globally.
    // In a multi-tenant deployment this subscription would need to be scoped
    // per tenant — one event storm from one tenant could starve others. (FLX-148)
    unsubscribeInsert = realtime.subscribeToTable<PipelineRunRealtimeRow>(
      'orchestrator-insert',
      'pipeline_run',
      'INSERT',
      (payload) => {
        const row = payload.new;
        if (row.status === PIPELINE_RUN_STATUS.pending) {
          handleNewRun(row.id).catch(logError('handleNewRun'));
        }
      }
    );

    unsubscribeUpdate = realtime.subscribeToTable<PipelineRunRealtimeRow>(
      'orchestrator-update',
      'pipeline_run',
      'UPDATE',
      (payload) => {
        const row = payload.new;
        if (row.status === PIPELINE_RUN_STATUS.pending) {
          handleNewRun(row.id).catch(logError('handleNewRun'));
        }
      }
    );

    // Drain any pending runs that were inserted before the Realtime
    // subscription was established (e.g., during daemon startup gap).
    drainPending().catch(logError('drainPending'));
  }

  function stop(): void {
    isRunning = false;
    unsubscribeInsert?.();
    unsubscribeInsert = null;
    unsubscribeUpdate?.();
    unsubscribeUpdate = null;
  }

  function logError(context: string) {
    return (err: unknown) => {
      console.error(`[orchestrator:${context}]`, err);
    };
  }

  // ─── Pipeline Handlers ──────────────────────────────────────────────

  async function handleNewRun(runId: string): Promise<void> {
    // Guard: prevent concurrent double-processing of the same run.
    // This fires when Realtime delivers duplicate events or when drainPending
    // races with an INSERT event for the same run.
    if (inFlight.has(runId)) return;
    inFlight.add(runId);

    try {
      const run = await runService.getRun(runId);
      if (!run || run.status !== PIPELINE_RUN_STATUS.pending) return;

      const stages = await runService.getStages(run.pipelineId);
      if (stages.length === 0) {
        await runService.updateRunStatus(runId, PIPELINE_RUN_STATUS.failed);
        return;
      }

      // Atomically claim a concurrency slot and flip the run from
      // pending → running. Returns false when the limit is at capacity
      // or another caller already raced this run forward. (FLX-199)
      const acquired = await runService.tryAcquireRunningSlot(
        runId,
        cfg.maxConcurrentRuns
      );
      if (!acquired) {
        console.log(
          `[orchestrator] concurrency limit reached or run no longer pending, run ${runId} queued`
        );
        return;
      }

      // Respect a user-specified stage: the tRPC trigger path creates a
      // stage_run at status='pending' (pipeline-run-service default) with
      // the stage the operator clicked. Daemon-autonomous runs have no
      // pre-seeded stage_run and fall back to stages[0]. Reuse the seed
      // row instead of creating a duplicate stage_run.
      const existingStageRuns = await runService.getStageRuns(run.id);
      const pendingSeed = existingStageRuns.find(
        (sr) => sr.status === STAGE_RUN_STATUS.pending
      );
      if (pendingSeed) {
        const seedStage = stages.find(
          (s) => s.id === pendingSeed.pipelineStageId
        );
        if (seedStage) {
          await launchStage(run, seedStage, pendingSeed);
          return;
        }
      }
      await launchStage(run, stages[0]);
    } finally {
      inFlight.delete(runId);
    }
  }

  /**
   * Drain the pending queue: pick up pending runs in FIFO order and start
   * them until the concurrency limit is reached.
   *
   * Called after finishRun() (slot freed) and after recoverOnStartup()
   * (existing pending runs may predate the Realtime subscription).
   *
   * Concurrency enforcement is delegated to handleNewRun via
   * tryAcquireRunningSlot, so two concurrent drainPending() invocations
   * cannot together exceed maxConcurrentRuns. (FLX-199)
   */
  async function drainPending(): Promise<void> {
    const pending = await runService.getPendingRuns();
    if (pending.length === 0) return;

    console.log(
      `[orchestrator:drain] ${pending.length} pending run(s) in queue`
    );

    for (const { id } of pending) {
      await handleNewRun(id);
    }
  }

  // ─── Crash Recovery ─────────────────────────────────────────────────

  async function recoverOnStartup(): Promise<void> {
    // Single-tenant assumption: recovers ALL globally-running stage runs.
    // In a multi-tenant deployment this could kill stage runs from another
    // tenant's daemon. A daemonInstanceId column on stage_run would scope
    // recovery to runs this daemon launched. (FLX-148)
    const staleRuns = await db
      .select()
      .from(stageRun)
      .where(eq(stageRun.status, STAGE_RUN_STATUS.running));

    for (const sRun of staleRuns) {
      const alive = sRun.pid ? isProcessAlive(sRun.pid) : false;

      if (!alive) {
        const [stage] = await db
          .select()
          .from(pipelineStage)
          .where(eq(pipelineStage.id, sRun.pipelineStageId));

        if (!stage) {
          await runService.completeStageRun(
            sRun.id,
            STAGE_RUN_STATUS.failed,
            {}
          );
          continue;
        }

        await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {});
        await runService.appendEvent(sRun.id, EVENT_TYPE.error, {
          message: 'Process died — crash recovery',
          attempt: sRun.attempt,
        });

        const maxRetries = stage.maxRetries ?? 0;
        if (sRun.attempt < maxRetries + 1) {
          const run = await runService.getRun(sRun.pipelineRunId);
          if (run) {
            await launchStage(run, stage);
          }
        } else {
          const run = await runService.getRun(sRun.pipelineRunId);
          if (run) {
            await finishRun(run, PIPELINE_RUN_STATUS.failed);
          } else {
            await runService.completeRun(
              sRun.pipelineRunId,
              PIPELINE_RUN_STATUS.failed
            );
          }
        }
      }
    }

    // After crash recovery, drain any pending runs that predate the daemon boot.
    // These will never receive a Realtime INSERT event since they were inserted
    // before the subscription was established.
    await drainPending();
  }

  function isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  return {
    start,
    stop,
    recoverOnStartup,
    get running() {
      return isRunning;
    },
  };
}
