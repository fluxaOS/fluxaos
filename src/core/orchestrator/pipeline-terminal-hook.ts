// src/core/orchestrator/pipeline-terminal-hook.ts

/**
 * Pipeline-terminal hook — T16 from R-RUNTIME.
 *
 * Fires when a pipeline_run flips to a terminal status. Two branches:
 *
 *   completed → invoke deployBridge.deploy(runId). Wrap in try/catch. On
 *               failure, log `deploy.failed`, allow the caller to mark DB
 *               failure state, then release the env.
 *
 *   failed    → call isolation.release(envId, { force: false }). If the
 *               worktree has uncommitted changes, swallow the error and
 *               leave the env for debugging.
 *
 * Zero vendor imports. DI-clean: takes DeployBridge + IsolationProvider +
 * logger. Safe to call from event-orchestrator.ts and manual-run.ts —
 * behaviour is idempotent (already-released envs are no-ops) and the deploy
 * bridge short-circuits when the run has no issue or the worktree is clean.
 */

import { PIPELINE_RUN_STATUS } from '@/core/constants';
import type { DeployBridge } from '@/core/deploy';
import { UncommittedChangesError } from '@/core/errors/git';
import type { IsolationProvider } from '@/core/ports/isolation';

export interface PipelineTerminalHookLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface PipelineTerminalHookDeps {
  deployBridge: DeployBridge;
  isolation: IsolationProvider;
  logger: PipelineTerminalHookLogger;
  onDeployFailure?: (input: {
    runId: string;
    projectId: string | null;
    error: unknown;
  }) => Promise<void>;
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
  const { deployBridge, isolation, logger, onDeployFailure } = deps;

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
      } catch (err) {
        logger.error(
          {
            runId,
            event: 'deploy.failed',
            error: err instanceof Error ? err.message : String(err),
          },
          'deploy.failed'
        );
        await onDeployFailure?.({ runId, projectId, error: err });
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
