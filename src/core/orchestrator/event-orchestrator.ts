/**
 * Event-Driven Orchestrator — the systemd-managed pipeline state machine.
 *
 * Subscribes to Realtime for pipeline_run and stage_run changes.
 * Reads all config from DB. Writes all state via PipelineRunService.
 * The harness never touches the database.
 *
 * State machine:
 *   pipeline_run created → read first stage → create stage_run
 *   stage_run queued → executeStageRun → running → completed/failed
 *   stage_run completed → evaluate gate → verdict determines next state
 *   stage_run failed → check retry budget → retry or fail permanently
 *   all stages done → complete pipeline_run → write issue events
 */
import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import type { StageExecutor } from '@/core/ports/stage-executor';
import type { RealtimeProvider } from '@/core/ports/realtime';
import type { Unsubscribe } from '@/core/ports/auth';
import {
  pipelineStage,
  pipelineRun,
  stageRun,
} from '@/core/db/schema';
import { createPipelineRunService } from './pipeline-run-service';
import { createGateService } from '@/core/gates/service';
import { executeStageRun } from './stage-runner';
import {
  PIPELINE_RUN_STATUS,
  STAGE_RUN_STATUS,
  EVENT_TYPE,
  ISSUE_EVENT_TYPE,
  GATE_MODE,
  GATE_VERDICT,
  DEFAULT_GATE_MODE,
} from '@/core/constants';
import type { GateMode } from '@/core/constants';

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

export function createEventOrchestrator(
  db: Database,
  executor: StageExecutor,
  realtime: RealtimeProvider,
  config: Partial<EventOrchestratorConfig> = {},
): EventOrchestrator {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const runService = createPipelineRunService(db);
  const gateService = createGateService(db);

  let unsubscribeInsert: Unsubscribe | null = null;
  let unsubscribeUpdate: Unsubscribe | null = null;
  let isRunning = false;

  // ─── Realtime Subscription ──────────────────────────────────────────

  function start(): void {
    if (isRunning) return;
    isRunning = true;

    unsubscribeInsert = realtime.subscribeToTable(
      'orchestrator-insert',
      'pipeline_run',
      'INSERT',
      (payload) => {
        const row = payload.new as typeof pipelineRun.$inferSelect;
        if (row.status === PIPELINE_RUN_STATUS.pending) {
          handleNewRun(row.id).catch(logError('handleNewRun'));
        }
      },
    );

    unsubscribeUpdate = realtime.subscribeToTable(
      'orchestrator-update',
      'pipeline_run',
      'UPDATE',
      (payload) => {
        const row = payload.new as typeof pipelineRun.$inferSelect;
        if (row.status === PIPELINE_RUN_STATUS.pending) {
          handleNewRun(row.id).catch(logError('handleNewRun'));
        }
      },
    );
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
    const run = await runService.getRun(runId);
    if (!run || run.status !== PIPELINE_RUN_STATUS.pending) return;

    // Check concurrency limit
    const running = await runService.getRunningRuns();
    if (running.length >= cfg.maxConcurrentRuns) return;

    // Get stages
    const stages = await runService.getStages(run.pipelineId);
    if (stages.length === 0) {
      await runService.updateRunStatus(runId, PIPELINE_RUN_STATUS.failed);
      return;
    }

    // Mark running
    await runService.updateRunStatus(runId, PIPELINE_RUN_STATUS.running);

    // Launch first stage
    await launchStage(run, stages[0]);
  }

  // ─── Stage Execution ────────────────────────────────────────────────

  async function launchStage(
    run: typeof pipelineRun.$inferSelect,
    stage: typeof pipelineStage.$inferSelect,
  ): Promise<void> {
    // Get existing stage runs for attempt counting
    const existingRuns = await runService.getStageRuns(run.id);
    const attemptsForStage = existingRuns.filter(
      (sr) => sr.pipelineStageId === stage.id,
    ).length;

    // Create stage_run
    const sRun = await runService.createStageRun(run.id, stage.id);

    // Evaluate pre-gate
    const gateMode = (stage.gateMode ?? DEFAULT_GATE_MODE) as GateMode;
    if (gateMode === GATE_MODE.hold || gateMode === GATE_MODE.manual) {
      await runService.updateStageRunStatus(sRun.id, STAGE_RUN_STATUS.pending);
      await runService.appendEvent(sRun.id, EVENT_TYPE.gate_checked, {
        verdict: GATE_VERDICT.hold,
        reason: `gate mode: ${gateMode}`,
      });
      if (run.issueId) {
        await runService.appendIssueEvent(
          run.issueId,
          ISSUE_EVENT_TYPE.gate_hold,
          {
            stageRunId: sRun.id,
            stageName: stage.name,
            verdict: GATE_VERDICT.hold,
            reason: `gate mode: ${gateMode}`,
          },
          'orchestrator',
        );
      }
      return;
    }

    // Execute the stage via shared stage-runner
    try {
      const result = await executeStageRun({
        db,
        executor,
        runService,
        runId: run.id,
        stageRunId: sRun.id,
      });

      // Post-execution gate evaluation
      if (result.exitCode === 0 && gateMode === GATE_MODE.rules) {
        const gateResult = await gateService.evaluateStageGate(
          stage.id,
          sRun.id,
          {
            exit_code: result.exitCode,
            cost_usd: 0,
            tokens_in: 0,
            tokens_out: 0,
            provider: result.providerName,
            model: result.modelIdentifier,
            harness: result.harnessName,
          },
        );

        await runService.appendEvent(sRun.id, EVENT_TYPE.gate_checked, {
          verdict: gateResult.verdict,
          passed: gateResult.passed,
          reason: gateResult.reason,
        });

        await applyVerdict(run, stage, sRun, gateResult.verdict);
      } else if (result.exitCode === 0) {
        // auto/skip gate → proceed
        await applyVerdict(run, stage, sRun, GATE_VERDICT.proceed);
      } else {
        // Failed — check retry budget
        await handleStageFailed(run, stage, sRun);
      }
    } catch {
      // Stage execution threw (timeout, signal, etc.)
      // stage-runner already marked stage_run as failed
      await handleStageFailed(run, stage, sRun);
    }
  }

  // ─── Verdict Application ────────────────────────────────────────────

  async function applyVerdict(
    run: typeof pipelineRun.$inferSelect,
    stage: typeof pipelineStage.$inferSelect,
    sRun: typeof stageRun.$inferSelect,
    verdict: string,
  ): Promise<void> {
    if (verdict === GATE_VERDICT.proceed) {
      const nextStage = await runService.getNextStage(
        run.pipelineId,
        stage.sortOrder,
      );

      if (nextStage) {
        await launchStage(run, nextStage);
      } else {
        await completePipelineRun(run);
      }
    } else if (verdict === GATE_VERDICT.hold) {
      await runService.updateStageRunStatus(sRun.id, STAGE_RUN_STATUS.pending);
    } else if (verdict === GATE_VERDICT.rework) {
      await handleStageFailed(run, stage, sRun);
    } else if (verdict === GATE_VERDICT.abort) {
      await runService.completeRun(run.id, PIPELINE_RUN_STATUS.failed);
      if (run.issueId) {
        await runService.appendIssueEvent(
          run.issueId,
          ISSUE_EVENT_TYPE.pipeline_failed,
          {
            pipelineRunId: run.id,
            reason: 'Gate verdict: abort',
            failedStage: stage.name,
          },
          'orchestrator',
        );
      }
    }
  }

  async function handleStageFailed(
    run: typeof pipelineRun.$inferSelect,
    stage: typeof pipelineStage.$inferSelect,
    sRun: typeof stageRun.$inferSelect,
  ): Promise<void> {
    const maxRetries = stage.maxRetries ?? 0;
    if (sRun.attempt < maxRetries + 1) {
      await launchStage(run, stage);
    } else {
      await runService.completeRun(run.id, PIPELINE_RUN_STATUS.failed);
      if (run.issueId) {
        await runService.appendIssueEvent(
          run.issueId,
          ISSUE_EVENT_TYPE.pipeline_failed,
          {
            pipelineRunId: run.id,
            reason: `Stage failed after ${sRun.attempt} attempt(s)`,
            failedStage: stage.name,
          },
          'orchestrator',
        );
      }
    }
  }

  async function completePipelineRun(
    run: typeof pipelineRun.$inferSelect,
  ): Promise<void> {
    await runService.completeRun(run.id, PIPELINE_RUN_STATUS.completed);
    if (run.issueId) {
      await runService.appendIssueEvent(
        run.issueId,
        ISSUE_EVENT_TYPE.pipeline_completed,
        { pipelineRunId: run.id },
        'orchestrator',
      );
    }
  }

  // ─── Crash Recovery ─────────────────────────────────────────────────

  async function recoverOnStartup(): Promise<void> {
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
          await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {});
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
          await runService.completeRun(sRun.pipelineRunId, PIPELINE_RUN_STATUS.failed);
        }
      }
    }
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
