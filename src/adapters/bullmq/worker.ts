import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GateMode, StageRunContext } from '@/core/gates';
import { evaluateGate } from '@/core/gates';
import { appendEvent } from '@/core/observability';
import { resolvePersona } from '@/core/personas';
import {
  advancePipelineRun,
  getStageRun,
  transitionPipelineRun,
  transitionStageRun,
} from '@/core/pipeline';
import type { StageExecutor } from '@/core/ports/stage-executor';
import type { RouteSelection } from '@/core/routing';
import { resolveRoute } from '@/core/routing';
import { materializeSkills } from '@/core/skills/materializer';

export const STAGE_QUEUE = 'stage-execution';

export interface StageJobData {
  stageRunId: string;
  pipelineRunId: string;
}

export async function processStageJob(
  data: StageJobData,
  executor: StageExecutor
): Promise<void> {
  const { stageRunId, pipelineRunId } = data;

  let tmpDir: string | null = null;

  try {
    // 1. Load stage run + config
    const sr = await getStageRun(stageRunId);
    const stage = sr.pipelineStage;

    // 2. Transition to running
    await transitionStageRun(stageRunId, 'running');

    // 3. Resolve persona
    let resolvedPersona = null;
    if (stage.personaId) {
      resolvedPersona = await resolvePersona(stage.personaId);
    }

    // 4. Resolve routing (provider, model, harness)
    let route: RouteSelection;
    try {
      route = await resolveRoute(stage.personaId, stage.name, stage.harness);
    } catch {
      // No provider available — use defaults
      route = {
        providerId: '',
        providerName: 'none',
        modelId: '',
        modelIdentifier: 'none',
        harness: stage.harness ?? 'claude-code',
      };
    }

    // 5. Materialize skills to temp dir
    if (resolvedPersona?.projectId) {
      tmpDir = await mkdtemp(join(tmpdir(), 'fluxaos-skills-'));
      await materializeSkills(resolvedPersona.projectId, tmpDir);
    }

    // 6. Build command
    const env: Record<string, string> = {
      FLUXAOS_STAGE: stage.name,
      FLUXAOS_HARNESS: route.harness,
      FLUXAOS_MODEL: route.modelIdentifier,
      FLUXAOS_PROVIDER: route.providerName,
    };

    if (tmpDir) {
      env.FLUXAOS_SKILLS_DIR = tmpDir;
    }
    if (resolvedPersona?.soul) {
      env.FLUXAOS_PERSONA_SOUL = resolvedPersona.soul;
    }

    // 7. Execute
    let stderr = '';

    const result = await executor.execute({
      command: route.harness,
      args: [],
      cwd: process.cwd(),
      env,
      timeoutMs: (stage.timeoutSec ?? 300) * 1000,
      onStdout: (chunk) => {
        appendEvent(stageRunId, 'output', {
          stream: 'stdout',
          data: chunk,
        });
      },
      onStderr: (chunk) => {
        stderr += chunk;
        appendEvent(stageRunId, 'output', {
          stream: 'stderr',
          data: chunk,
        });
      },
    });

    // 8. Record results
    await transitionStageRun(stageRunId, 'completed', {
      provider: route.providerName,
      model: route.modelIdentifier,
      harness: route.harness,
      costUsd: '0', // Cost parsing deferred to Phase 6
      tokensIn: 0,
      tokensOut: 0,
    });

    await appendEvent(stageRunId, 'cost_recorded', {
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      costUsd: '0',
      tokensIn: 0,
      tokensOut: 0,
    });

    // 9. Evaluate gate
    const gateContext: StageRunContext = {
      exitCode: result.exitCode,
      costUsd: '0',
      stderr,
      tokensIn: 0,
      tokensOut: 0,
    };

    const gateResult = evaluateGate(
      (stage.gateMode ?? 'auto') as GateMode,
      stage.gateRules,
      gateContext
    );

    await appendEvent(stageRunId, 'gate_evaluated', {
      verdict: gateResult.verdict,
      reason: gateResult.reason,
      rules: gateResult.rules,
    });

    // 10. Act on gate verdict
    switch (gateResult.verdict) {
      case 'proceed':
        await advancePipelineRun(pipelineRunId);
        break;

      case 'hold':
        await appendEvent(stageRunId, 'gate_hold', {
          reason: gateResult.reason,
        });
        // Stage stays completed — waiting for human approval
        break;

      case 'rework':
        await transitionStageRun(stageRunId, 'rework');
        // Re-queue for re-execution (caller is responsible for enqueuing)
        break;

      case 'abort':
        await transitionStageRun(stageRunId, 'failed');
        await transitionPipelineRun(pipelineRunId, 'failed');
        break;
    }
  } catch (error) {
    // Stage execution failed
    try {
      await transitionStageRun(stageRunId, 'failed');
      await appendEvent(stageRunId, 'stage_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      await transitionPipelineRun(pipelineRunId, 'failed');
    } catch {
      // Best-effort error recording
    }
  } finally {
    // Cleanup temp dir
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
