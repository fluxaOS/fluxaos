// src/core/orchestrator/pipeline-terminal-hook.ts

/**
 * Pipeline-terminal hook — T16 from R-RUNTIME.
 *
 * Fires when a pipeline_run flips to a terminal status. Two branches:
 *
 *   completed → invoke deployBridge.deploy(runId). Wrap in try/catch. On
 *               failure, write a deploy_run row (status=failed) and release
 *               the env. Pipeline/stage rows stay completed — they describe
 *               pipeline execution, not the post-pipeline deploy outcome
 *               (FLX-197).
 *
 *   failed    → call isolation.release(envId, { force: false }). If the
 *               worktree has uncommitted changes, swallow the error and
 *               leave the env for debugging.
 *
 * Zero vendor imports. DI-clean: takes DeployBridge + IsolationProvider +
 * logger + db. Safe to call from event-orchestrator.ts and manual-run.ts —
 * behaviour is idempotent (already-released envs are no-ops) and the deploy
 * bridge short-circuits when the run has no issue or the worktree is clean.
 */

import { DEPLOY_RUN_STATUS, PIPELINE_RUN_STATUS } from '@/core/constants';
import type { Database } from '@/core/db/connection';
import { deployRun } from '@/core/db/schema';
import { type DeployBridge, DeployBridgeError } from '@/core/deploy';
import { UncommittedChangesError } from '@/core/errors/git';
import type { IsolationProvider } from '@/core/ports/isolation';

export interface PipelineTerminalHookLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface PipelineTerminalHookDeps {
  db: Database;
  deployBridge: DeployBridge;
  isolation: IsolationProvider;
  logger: PipelineTerminalHookLogger;
}

export interface PipelineTerminalHook {
  /**
   * Called immediately after `runService.completeRun(runId, status)` writes
   * a terminal status to the pipeline_run row.
   */
  onTerminal(input: {
    runId: string;
    projectId: string | null;
    status: string;
  }): Promise<void>;
}

export function createPipelineTerminalHook(
  deps: PipelineTerminalHookDeps
): PipelineTerminalHook {
  const { db, deployBridge, isolation, logger } = deps;

  async function onTerminal(input: {
    runId: string;
    projectId: string | null;
    status: string;
  }): Promise<void> {
    const { runId, projectId, status } = input;

    if (status === PIPELINE_RUN_STATUS.completed) {
      try {
        const result = await deployBridge.deploy(runId);
        logger.info(
          { runId, skipped: result.skipped, event: 'deploy.invoked' },
          'deploy.invoked'
        );
        if (result.skipped) {
          await releaseTerminalEnv({
            runId,
            projectId,
            releaseEvent: 'terminal-hook.env-released-after-deploy-skipped',
            releaseMessage:
              'pipeline-terminal-hook: env released after deploy skipped',
          });
        }
      } catch (err) {
        logger.error(
          {
            runId,
            event: 'deploy.failed',
            error: err instanceof Error ? err.message : String(err),
          },
          'deploy.failed'
        );
        // FLX-197: deploy is post-pipeline. Record the failure on its own
        // row — never mutate stage_run/pipeline_run, those describe pipeline
        // execution which already succeeded.
        await recordDeployFailure(runId, err);
        await releaseTerminalEnv({
          runId,
          projectId,
          releaseEvent: 'terminal-hook.env-released-after-deploy-failure',
          releaseMessage:
            'pipeline-terminal-hook: env released after deploy failure',
        });
      }
      return;
    }

    // All other terminal statuses (failed, timed_out, cancelled) → release
    // the env. Swallow UncommittedChangesError so a dirty worktree doesn't
    // block the orchestrator — it stays for debugging.
    await releaseTerminalEnv({
      runId,
      projectId,
      releaseEvent: 'terminal-hook.env-released',
      releaseMessage:
        'pipeline-terminal-hook: env released on non-completed terminal',
    });
  }

  async function recordDeployFailure(
    runId: string,
    err: unknown
  ): Promise<void> {
    const errorStage = err instanceof DeployBridgeError ? err.stage : null;
    const errorMessage = err instanceof Error ? err.message : String(err);
    try {
      await db.insert(deployRun).values({
        pipelineRunId: runId,
        status: DEPLOY_RUN_STATUS.failed,
        errorStage,
        errorMessage,
        completedAt: new Date(),
      });
    } catch (insertErr) {
      // Recording-the-record failure: log and move on. The original deploy
      // failure is already logged above; we don't want this to crash the
      // terminal hook (env still needs releasing).
      logger.error(
        {
          runId,
          event: 'deploy.failed_record_insert_error',
          error:
            insertErr instanceof Error ? insertErr.message : String(insertErr),
        },
        'deploy.failed_record_insert_error'
      );
    }
  }

  async function releaseTerminalEnv(input: {
    runId: string;
    projectId: string | null;
    releaseEvent: string;
    releaseMessage: string;
  }): Promise<void> {
    const { runId, projectId, releaseEvent, releaseMessage } = input;
    if (!projectId) {
      logger.warn(
        { runId, event: 'terminal-hook.no-project' },
        'pipeline-terminal-hook: no projectId on run; cannot locate env'
      );
      return;
    }

    try {
      const env = await isolation.findActiveByRun(projectId, runId);
      if (!env) return;
      await isolation.release(env.id, { force: false });
      logger.info(
        {
          runId,
          envId: env.id,
          event: releaseEvent,
        },
        releaseMessage
      );
    } catch (err) {
      if (err instanceof UncommittedChangesError) {
        logger.warn(
          { runId, event: 'terminal-hook.env-dirty' },
          'pipeline-terminal-hook: uncommitted changes — env left for debugging'
        );
        return;
      }
      logger.error(
        {
          runId,
          event: 'terminal-hook.release-failed',
          error: err instanceof Error ? err.message : String(err),
        },
        'pipeline-terminal-hook: env release failed'
      );
    }
  }

  return { onTerminal };
}
