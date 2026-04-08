import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GateMode, StageRunContext } from '@/core/gates';
import { evaluateGate } from '@/core/gates';
import { appendEvent } from '@/core/observability';
import { resolvePersona } from '@/core/personas';
import {
  advancePipelineRun,
  getPipelineRun,
  getStageRun,
  transitionPipelineRun,
  transitionStageRun,
} from '@/core/pipeline';
import { parseCostFromOutput } from '@/core/pipeline/cost-parser';
import { assemblePrompt } from '@/core/pipeline/prompt-assembler';
import type { StageExecutor } from '@/core/ports/stage-executor';
import type { RouteSelection } from '@/core/routing';
import { resolveRoutes } from '@/core/routing';
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

    // 4. Resolve routing — get ranked candidates for fallback
    let routes: RouteSelection[];
    try {
      routes = await resolveRoutes(stage.personaId, stage.name, stage.harness);
    } catch {
      // No providers available — use default fallback
      routes = [
        {
          providerId: '',
          providerName: 'none',
          modelId: '',
          modelIdentifier: 'none',
          harness: stage.harness ?? 'claude-code',
        },
      ];
    }

    if (routes.length === 0) {
      routes = [
        {
          providerId: '',
          providerName: 'none',
          modelId: '',
          modelIdentifier: 'none',
          harness: stage.harness ?? 'claude-code',
        },
      ];
    }

    // 5. Materialize skills to temp dir
    if (resolvedPersona?.projectId) {
      tmpDir = await mkdtemp(join(tmpdir(), 'fluxaos-skills-'));
      await materializeSkills(resolvedPersona.projectId, tmpDir);
    }

    // 6. Assemble prompt from issue + persona + skills
    const run = await getPipelineRun(pipelineRunId);

    const prompt = await assemblePrompt({
      issueId: run.issueId,
      personaSoul: resolvedPersona?.soul ?? null,
      stageName: stage.name,
      skillsDir: tmpDir,
    });

    // 7. Try each route candidate (provider fallback)
    let lastError: Error | null = null;

    for (const route of routes) {
      try {
        await executeWithRoute(
          stageRunId,
          pipelineRunId,
          stage,
          route,
          prompt,
          tmpDir,
          resolvedPersona,
          executor
        );
        return; // Success — exit
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await appendEvent(stageRunId, 'provider_failed', {
          provider: route.providerName,
          model: route.modelIdentifier,
          error: lastError.message,
        });
        // Continue to next candidate
      }
    }

    // All candidates failed
    throw lastError ?? new Error('All provider candidates failed');
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

async function executeWithRoute(
  stageRunId: string,
  pipelineRunId: string,
  stage: {
    name: string;
    timeoutSec: number | null;
    gateMode: string | null;
    gateRules: unknown;
  },
  route: RouteSelection,
  prompt: string,
  tmpDir: string | null,
  resolvedPersona: { soul: string | null; projectId: string | null } | null,
  executor: StageExecutor
): Promise<void> {
  // Build environment
  const env: Record<string, string> = {
    FLUXAOS_STAGE: stage.name,
    FLUXAOS_HARNESS: route.harness,
    FLUXAOS_MODEL: route.modelIdentifier,
    FLUXAOS_PROVIDER: route.providerName,
    FLUXAOS_PROMPT: prompt,
  };

  if (tmpDir) {
    env.FLUXAOS_SKILLS_DIR = tmpDir;
  }
  if (resolvedPersona?.soul) {
    env.FLUXAOS_PERSONA_SOUL = resolvedPersona.soul;
  }

  // Execute harness subprocess
  let stdout = '';
  let stderr = '';

  const result = await executor.execute({
    command: route.harness,
    args: [],
    cwd: process.cwd(),
    env,
    timeoutMs: (stage.timeoutSec ?? 300) * 1000,
    onStdout: (chunk) => {
      stdout += chunk;
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

  // Parse cost from harness output
  const parsed = parseCostFromOutput(stdout);
  const costUsd = parsed?.costUsd ?? '0';
  const tokensIn = parsed?.tokensIn ?? 0;
  const tokensOut = parsed?.tokensOut ?? 0;

  // Record results with real cost data
  await transitionStageRun(stageRunId, 'completed', {
    provider: route.providerName,
    model: route.modelIdentifier,
    harness: route.harness,
    costUsd,
    tokensIn,
    tokensOut,
  });

  await appendEvent(stageRunId, 'cost_recorded', {
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    costUsd,
    tokensIn,
    tokensOut,
  });

  // Evaluate gate
  const gateContext: StageRunContext = {
    exitCode: result.exitCode,
    costUsd,
    stderr,
    tokensIn,
    tokensOut,
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

  // Act on gate verdict
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
}
