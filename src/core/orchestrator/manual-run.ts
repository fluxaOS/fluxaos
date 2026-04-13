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
import { createPipelineRunService, type PipelineRunService } from './pipeline-run-service';
import { createGateService } from '@/core/gates/service';
import { createIssueService } from '@/core/services/issue';
import { executeStageRun } from './stage-runner';
import {
  PIPELINE_RUN_STATUS,
  ISSUE_EVENT_TYPE,
  EVENT_TYPE,
  GATE_MODE,
  DEFAULT_GATE_MODE,
} from '@/core/constants';
import { eq, and } from 'drizzle-orm';
import { pipelineStage, stageRun, issue } from '@/core/db/schema';

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

      // Transition issue state on success — advance to the next stage's state
      if (result.exitCode === 0) {
        await transitionIssueState(db, result.issueId, result.stageId, runService);
      }
    }
  } catch (err) {
    console.error('[manual-run]', err);
    await runService.failStageAndRun(stageRunId, runId);
  }
}

/**
 * Advance the issue state after a successful stage completion.
 *
 * Derives the target state from the pipeline structure:
 * 1. Find the next pipeline stage (by sort order)
 * 2. The next stage's name is the target issue state key
 * 3. If no next stage (pipeline complete), look for a terminal state transition
 * 4. Validate via the issue transition table — only allowed transitions fire
 *
 * No hardcoded state mappings. Everything comes from the DB.
 */
async function transitionIssueState(
  db: Database,
  issueId: string,
  stageId: string,
  runService: PipelineRunService,
): Promise<void> {
  try {
    const issueService = createIssueService(db);

    // Get the issue
    const [iss] = await db
      .select({ id: issue.id, stateId: issue.stateId, version: issue.version })
      .from(issue)
      .where(eq(issue.id, issueId));
    if (!iss) return;

    // Get the completed stage to find its pipeline and sort order
    const [completedStage] = await db
      .select()
      .from(pipelineStage)
      .where(eq(pipelineStage.id, stageId));
    if (!completedStage) return;

    // Find the next stage in the pipeline
    const nextStage = await runService.getNextStage(
      completedStage.pipelineId,
      completedStage.sortOrder,
    );

    // Determine target state key:
    // - If there's a next stage, its name is the target state (e.g. "implement" → "review")
    // - If no next stage, the pipeline is done — look for terminal states
    let targetStateKey: string | null = null;
    if (nextStage) {
      targetStateKey = nextStage.name;
    } else {
      // Pipeline complete — find a terminal state in the valid transitions
      const transitions = await issueService.getValidTransitions(issueId);
      const terminalTransition = transitions.find(
        (t: { isTerminal: boolean }) => t.isTerminal,
      );
      if (terminalTransition) {
        targetStateKey = terminalTransition.key;
      }
    }

    if (!targetStateKey) return;

    // Find the matching valid transition from the issue's current state
    const transitions = await issueService.getValidTransitions(issueId);
    const matchingTransition = transitions.find(
      (t: { key: string }) => t.key === targetStateKey,
    );
    if (!matchingTransition) return;

    // Transition the issue via the service (validates against transition table)
    await issueService.transition(iss.id, matchingTransition.id, iss.version, 'manual-run');

    await runService.appendIssueEvent(
      issueId,
      'state_changed',
      {
        from: completedStage.name,
        to: targetStateKey,
        trigger: 'stage_completion',
      },
      'manual-run',
    );
  } catch (err) {
    // State transition failure is not fatal — log and continue
    console.error('[manual-run] state transition failed:', err);
  }
}
