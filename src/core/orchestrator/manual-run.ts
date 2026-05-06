// src/core/orchestrator/manual-run.ts

import { eq } from 'drizzle-orm';
import {
  ACTOR,
  CONFIG_KEY,
  EVENT_TYPE,
  GATE_VERDICT,
  ISSUE_EVENT_TYPE,
  PIPELINE_RUN_STATUS,
  TRIGGER_TYPE,
} from '@/core/constants';
/**
 * Manual Run Executor — runs a single stage without the orchestrator daemon.
 *
 * Called fire-and-forget from the tRPC trigger mutation. Delegates all
 * execution logic to the shared stage-runner. Handles pipeline-level
 * completion and gate evaluation.
 */
import type { Database } from '@/core/db/connection';
import { issue, stageRun } from '@/core/db/schema';
import { createGateService } from '@/core/gates/service';
import type { GitOpsPort } from '@/core/ports/git';
import type { IsolationProvider } from '@/core/ports/isolation';
import type { StageExecutor } from '@/core/ports/stage-executor';
import type { StdoutParser } from '@/core/ports/stdout-parser';
import type { WorkspaceMaterializerPort } from '@/core/ports/workspace-materializer';
import { createIssueService } from '@/core/services/issue';
import { createPipelineRunService } from './pipeline-run-service';
import { resolveProjectIdForRun } from './run-helpers';
import type { PipelineTerminalHook } from './pipeline-terminal-hook';
import { executeStageRun } from './stage-runner';

/**
 * Execute a single stage run. Fire-and-forget — caller does not await.
 * All state is written to the DB; the UI reads it via Realtime.
 */
export async function executeManualRun(
  db: Database,
  executor: StageExecutor,
  isolation: IsolationProvider,
  terminalHook: PipelineTerminalHook,
  stdoutParser: StdoutParser,
  wsMaterializer: WorkspaceMaterializerPort,
  runId: string,
  stageRunId: string,
  gitOps?: GitOpsPort
): Promise<void> {
  const runService = createPipelineRunService(db);
  const gateService = createGateService(db);

  try {
    const result = await executeStageRun({
      db,
      executor,
      runService,
      isolation,
      stdoutParser,
      wsMaterializer,
      gitOps: gitOps ?? createNoopGitOps(),
      runId,
      stageRunId,
      trigger: TRIGGER_TYPE.manual,
    });

    // Gate evaluation — always write a result row for every stage run
    const [sRun] = await db
      .select({ pipelineStageId: stageRun.pipelineStageId })
      .from(stageRun)
      .where(eq(stageRun.id, stageRunId));
    if (sRun) {
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
          driver: result.driverName,
          skill_signal: result.skillSignal,
        }
      );
      await runService.appendEvent(stageRunId, EVENT_TYPE.gate_checked, {
        verdict: gateResult.verdict,
        passed: gateResult.passed,
        reason: gateResult.reason,
      });
    }

    // Handle hold verdict from skill signal
    if (result.skillSignal === GATE_VERDICT.hold && result.issueId) {
      const issueService = createIssueService(db);
      const [issueRow] = await db
        .select()
        .from(issue)
        .where(eq(issue.id, result.issueId));

      if (issueRow) {
        const targetStateKey = result.skillMetadata?.targetState as
          | string
          | undefined;

        if (targetStateKey) {
          // Skill declared a targetState — override the issue state unconditionally.
          // The reason string is informational only; routing decision belongs to the skill.
          const targetState = await issueService.getStateByKey(
            issueRow.projectId,
            targetStateKey
          );
          await db.transaction(async (tx) => {
            const txIssueService = createIssueService(tx);
            const txRunService = createPipelineRunService(tx);
            await txIssueService.stateOverride(
              result.issueId!,
              targetState.id,
              issueRow.version,
              ACTOR.orchestrator
            );
            await txRunService.appendIssueEvent(
              result.issueId!,
              ISSUE_EVENT_TYPE.state_changed,
              { reason: result.skillSignalReason ?? 'hold', targetState: targetStateKey },
              ACTOR.manualRun
            );
          });
        } else {
          // No targetState declared — block the issue and surface the reason.
          const blockedStatusId = await issueService.getStatusIdByConfigKey(
            issueRow.projectId,
            CONFIG_KEY.issueStatusOnBlocked
          );
          const question = result.skillMetadata?.question as string | undefined;
          await db.transaction(async (tx) => {
            const txIssueService = createIssueService(tx);
            const txRunService = createPipelineRunService(tx);
            await txIssueService.updateStatus(
              result.issueId!,
              blockedStatusId,
              ACTOR.orchestrator,
              issueRow.version,
              question
            );
            await txRunService.appendIssueEvent(
              result.issueId!,
              ISSUE_EVENT_TYPE.pipeline_failed,
              { reason: result.skillSignalReason ?? 'needs_human', question },
              ACTOR.manualRun
            );
          });
        }
      }
    }

    // Complete pipeline run
    const status =
      result.exitCode === 0
        ? PIPELINE_RUN_STATUS.completed
        : PIPELINE_RUN_STATUS.failed;
    await runService.completeRun(runId, status);

    // Pipeline-level issue events
    if (result.issueId) {
      const issueEventType =
        result.exitCode === 0
          ? ISSUE_EVENT_TYPE.pipeline_completed
          : ISSUE_EVENT_TYPE.pipeline_failed;
      await runService.appendIssueEvent(
        result.issueId,
        issueEventType,
        { runId, exitCode: result.exitCode },
        ACTOR.manualRun
      );
    }

    // T16: terminal hook — deploy on completed, release env on failed.
    const projectId = await resolveProjectIdForRun(db, runId);
    await terminalHook.onTerminal({ runId, projectId, status });
  } catch (err) {
    console.error('[manual-run]', err);
    await runService.failStageAndRun(stageRunId, runId);
    // Best-effort terminal hook on the failure path too.
    try {
      const projectId = await resolveProjectIdForRun(db, runId);
      await terminalHook.onTerminal({
        runId,
        projectId,
        status: PIPELINE_RUN_STATUS.failed,
      });
    } catch (hookErr) {
      console.error('[manual-run] terminal hook failed:', hookErr);
    }
  }
}


function createNoopGitOps(): GitOpsPort {
  const notImpl = (name: string) => () => {
    throw new Error(
      `GitOpsPort.${name} called but no gitOps was injected into executeManualRun`
    );
  };
  return {
    commitAll: notImpl('commitAll') as GitOpsPort['commitAll'],
    getHeadSha: notImpl('getHeadSha') as GitOpsPort['getHeadSha'],
    push: notImpl('push') as GitOpsPort['push'],
    resolveRepoIdentity: notImpl(
      'resolveRepoIdentity'
    ) as GitOpsPort['resolveRepoIdentity'],
    branchAheadCount: notImpl(
      'branchAheadCount'
    ) as GitOpsPort['branchAheadCount'],
  };
}
