/**
 * Stage Worker — processes stage execution jobs from BullMQ.
 *
 * The worker is a dumb pipe. It:
 * 1. Receives a job with routing + prompt + config
 * 2. Builds the command from the resolved driver
 * 3. Calls StageExecutor.execute()
 * 4. Streams output events
 * 5. Records completion (exit code, cost, tokens)
 *
 * The worker does NOT:
 * - Know what pipeline stage it's running
 * - Make routing or transition decisions
 * - Update pipeline state
 * - Poll the database for status
 *
 * It's read-only on the database except for:
 * - Updating its own stage run status/results
 * - Appending events to the event store
 * - Adding a comment to the issue with its output
 */
import type { Job } from '@/core/ports/queue';
import type { StageExecutor } from '@/core/ports/stage-executor';
import type { Database } from '@/core/db/connection';
import { createPipelineRunService } from './pipeline-run-service';
import type { StageJobPayload } from './types';

export interface StageWorkerDeps {
  db: Database;
  executor: StageExecutor;
  onOutput?: (stageRunId: string, text: string) => void;
}

/**
 * Create the job handler function for the BullMQ worker.
 * Returns a function that processes a single stage execution job.
 */
export function createStageJobHandler(deps: StageWorkerDeps) {
  const { db, executor, onOutput } = deps;
  const runService = createPipelineRunService(db);

  return async function handleStageJob(job: Job<StageJobPayload>): Promise<void> {
    const payload = job.data;
    const { stageRunId, routing, prompt, cwd, timeoutMs } = payload;

    // 1. Mark stage as running
    await runService.updateStageRunStatus(stageRunId, 'running');
    await runService.appendEvent(stageRunId, 'launched', {
      provider: routing.providerName,
      model: routing.modelIdentifier,
      driver: routing.driver,
    });

    // 2. Build execution command from driver config
    const { command, args, env } = buildCommand(routing, prompt);

    try {
      // 3. Execute
      const result = await executor.execute({
        command,
        args,
        cwd,
        env,
        timeoutMs,
        onStdout: (text) => {
          onOutput?.(stageRunId, text);
          // Append output events (batched — not every line)
        },
        onStderr: (text) => {
          onOutput?.(stageRunId, text);
        },
      });

      // 4. Calculate cost from token usage
      const costUsd = estimateCost(
        result.stdout,
        routing.costPer1kInput,
        routing.costPer1kOutput,
      );

      // 5. Determine status from exit code
      const status = result.exitCode === 0 ? 'completed' : 'failed';

      // 6. Record completion
      await runService.completeStageRun(stageRunId, status, {
        provider: routing.providerName,
        model: routing.modelIdentifier,
        driver: routing.driver,
        costUsd: costUsd.toFixed(6),
        tokensIn: 0, // TODO: parse from provider output
        tokensOut: 0,
      });

      await runService.appendEvent(stageRunId, status, {
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        costUsd,
      });
    } catch (err) {
      // Execution error (not a process failure — an infra error)
      const message = err instanceof Error ? err.message : String(err);

      // Check if it was a timeout
      const isTimeout = message.includes('timed out') || message.includes('ETIMEDOUT');
      const status = isTimeout ? 'timed_out' : 'failed';

      await runService.completeStageRun(stageRunId, status, {
        provider: routing.providerName,
        model: routing.modelIdentifier,
        driver: routing.driver,
      });

      await runService.appendEvent(stageRunId, isTimeout ? 'timed_out' : 'error', {
        error: message,
      });
    }
  };
}

// ─── Command Builder ───────────────────────────────────────────────────────

/**
 * Build the execution command from routing config.
 * The driver name determines the command structure.
 * This is the ONLY place where driver names are interpreted.
 */
function buildCommand(
  routing: StageJobPayload['routing'],
  prompt: string,
): { command: string; args: string[]; env: Record<string, string> } {
  const env: Record<string, string> = {};

  // Pass routing info via environment — the process reads these
  env.FLUXAOS_PROVIDER = routing.providerName;
  env.FLUXAOS_MODEL = routing.modelIdentifier;
  env.FLUXAOS_PROMPT = prompt;

  if (routing.providerApiKeyRef) {
    // The key ref is an env var name, not the key itself
    const keyValue = process.env[routing.providerApiKeyRef];
    if (keyValue) {
      env.FLUXAOS_API_KEY = keyValue;
    }
  }

  // The driver is just a command name.
  // The user configures what command each driver maps to.
  // For now: the driver IS the command.
  return {
    command: routing.driver,
    args: ['--prompt', prompt, '--model', routing.modelIdentifier],
    env,
  };
}

// ─── Cost Estimation ───────────────────────────────────────────────────────

/**
 * Estimate cost from output. This is a rough estimate —
 * real cost tracking requires parsing provider-specific output formats.
 */
function estimateCost(
  _stdout: string,
  _costPer1kInput: number,
  _costPer1kOutput: number,
): number {
  // TODO: Parse token counts from provider output
  // Different providers report usage differently.
  // For now, return 0 — real cost tracking is a follow-up.
  return 0;
}
