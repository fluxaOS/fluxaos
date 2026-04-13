// src/core/orchestrator/manual-run.ts

/**
 * Manual Run Executor — runs a single stage without the orchestrator daemon.
 *
 * Called fire-and-forget from the tRPC trigger mutation. Delegates all
 * execution logic to the shared stage-runner. Handles pipeline-level
 * completion and gate evaluation.
 */
import type { Database } from '@/core/db/connection';
import type { StageExecutor } from '@/core/ports/stage-executor';
import { createPipelineRunService } from './pipeline-run-service';
import { createGateService } from '@/core/gates/service';
import { executeStageRun } from './stage-runner';
import {
  PIPELINE_RUN_STATUS,
  ISSUE_EVENT_TYPE,
  EVENT_TYPE,
  GATE_MODE,
  DEFAULT_GATE_MODE,
  TRIGGER_TYPE,
} from '@/core/constants';
import { eq } from 'drizzle-orm';
import { pipelineStage, stageRun } from '@/core/db/schema';

/**
 * Execute a single stage run. Fire-and-forget — caller does not await.
 * All state is written to the DB; the UI reads it via Realtime.
 */
export async function executeManualRun(
  db: Database,
  executor: StageExecutor,
  runId: string,
  stageRunId: string,
): Promise<void> {
  const runService = createPipelineRunService(db);
  const gateService = createGateService(db);

  try {
    const result = await executeStageRun({
      db,
      executor,
      runService,
      runId,
      stageRunId,
      trigger: TRIGGER_TYPE.manual,
    });

    // Gate evaluation (if stage has gates configured)
    const [sRun] = await db
      .select({ pipelineStageId: stageRun.pipelineStageId })
      .from(stageRun)
      .where(eq(stageRun.id, stageRunId));
    if (sRun) {
      const [stage] = await db
        .select({ gateMode: pipelineStage.gateMode })
        .from(pipelineStage)
        .where(eq(pipelineStage.id, sRun.pipelineStageId));

      const gateMode = (stage?.gateMode ?? DEFAULT_GATE_MODE) as string;
      if (result.exitCode === 0 && gateMode === GATE_MODE.rules) {
        const gateResult = await gateService.evaluateStageGate(
          sRun.pipelineStageId,
          stageRunId,
          {
            exit_code: result.exitCode,
            cost_usd: 0,
            tokens_in: 0,
            tokens_out: 0,
            provider: result.providerName,
            model: result.modelIdentifier,
            harness: result.harnessName,
            skill_signal: result.skillSignal,
          },
        );
        await runService.appendEvent(stageRunId, EVENT_TYPE.gate_checked, {
          verdict: gateResult.verdict,
          passed: gateResult.passed,
          reason: gateResult.reason,
        });
      }
    }

    // Complete pipeline run
    const status = result.exitCode === 0
      ? PIPELINE_RUN_STATUS.completed
      : PIPELINE_RUN_STATUS.failed;
    await runService.completeRun(runId, status);

    // Pipeline-level issue events
    if (result.issueId) {
      const issueEventType = result.exitCode === 0
        ? ISSUE_EVENT_TYPE.pipeline_completed
        : ISSUE_EVENT_TYPE.pipeline_failed;
      await runService.appendIssueEvent(
        result.issueId,
        issueEventType,
        { runId, exitCode: result.exitCode },
        'manual-run',
      );
    }
  } catch (err) {
    console.error('[manual-run]', err);
    await runService.failStageAndRun(stageRunId, runId);
  }
}
