// src/core/orchestrator/stage-runner.ts

/**
 * Stage Runner — shared execution logic for a single stage run.
 *
 * Loads all config from DB, materializes workspace, builds command,
 * spawns subprocess, streams output to events, completes stage run.
 *
 * Used by both manual-run (fire-and-forget from tRPC) and
 * event-orchestrator (Realtime-driven state machine).
 */
import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import type { StageExecutor } from '@/core/ports/stage-executor';
import type { PipelineRunService } from './pipeline-run-service';
import {
  pipelineRun,
  pipelineStage,
  stageRun,
  issue,
  skill,
  harnessCatalog,
  persona,
  brand,
  pipeline,
} from '@/core/db/schema';
import { materialize, cleanup } from '@/core/skills/materializer';
import { buildCommand, renderTemplate } from './command-builder';
import { getParser } from './output-parser';
import { parseSignalLine, type SkillSignal } from './signal-parser';
import { createRoutingResolver } from './routing-resolver';
import type { TriggerType } from '@/core/constants';
import {
  STAGE_RUN_STATUS,
  EVENT_TYPE,
  ISSUE_EVENT_TYPE,
  DEFAULT_STAGE_TIMEOUT_SEC,
} from '@/core/constants';

// ── Types ────────────────────────────────────────────────────────────

export interface StageRunContext {
  db: Database;
  executor: StageExecutor;
  runService: PipelineRunService;
  runId: string;
  stageRunId: string;
  trigger: TriggerType;
}

export interface StageRunResult {
  exitCode: number;
  durationMs: number;
  stageName: string;
  harnessName: string;
  providerName: string | null;
  modelIdentifier: string | null;
  issueId: string | null;
  stageId: string;
  skillSignal: string | null;
  skillMetadata: Record<string, unknown> | null;
}

// ── Main ─────────────────────────────────────────────────────────────

/**
 * Execute a single stage run end-to-end.
 *
 * Loads all config from DB, materializes workspace, builds command,
 * spawns subprocess, streams output to events, completes stage run.
 *
 * Does NOT complete the pipeline run or write pipeline-level issue events —
 * that's the caller's responsibility (manual-run vs orchestrator have
 * different pipeline progression logic).
 */
export async function executeStageRun(
  ctx: StageRunContext,
): Promise<StageRunResult> {
  const { db, executor, runService, runId, stageRunId } = ctx;

  // ── Load all required data ───────────────────────────────────────

  const [run] = await db
    .select()
    .from(pipelineRun)
    .where(eq(pipelineRun.id, runId));
  if (!run) throw new Error(`Pipeline run not found: ${runId}`);

  const [sRun] = await db
    .select()
    .from(stageRun)
    .where(eq(stageRun.id, stageRunId));
  if (!sRun) throw new Error(`Stage run not found: ${stageRunId}`);

  const [stage] = await db
    .select()
    .from(pipelineStage)
    .where(eq(pipelineStage.id, sRun.pipelineStageId));
  if (!stage) throw new Error(`Pipeline stage not found: ${sRun.pipelineStageId}`);

  // Harness (required)
  let harnessRow: typeof harnessCatalog.$inferSelect | null = null;
  if (stage.harnessId) {
    const [h] = await db
      .select()
      .from(harnessCatalog)
      .where(eq(harnessCatalog.id, stage.harnessId));
    harnessRow = h ?? null;
  }
  if (!harnessRow) {
    await runService.appendEvent(stageRunId, EVENT_TYPE.error, {
      error: 'No harness configured for stage',
      stageName: stage.name,
    });
    throw new Error(`No harness configured for stage: ${stage.name}`);
  }

  if (!harnessRow.outputFormat) {
    throw new Error(`Harness '${harnessRow.name}' has no output_format configured`);
  }

  // Skill (optional)
  let skillRow: typeof skill.$inferSelect | null = null;
  if (stage.skillId) {
    const [s] = await db
      .select()
      .from(skill)
      .where(eq(skill.id, stage.skillId));
    skillRow = s ?? null;
  }

  // Issue (optional)
  let issueRow: typeof issue.$inferSelect | null = null;
  if (run.issueId) {
    const [i] = await db
      .select()
      .from(issue)
      .where(eq(issue.id, run.issueId));
    issueRow = i ?? null;
  }

  // Routing
  const routingResolver = createRoutingResolver(db);
  let projectId: string | null = issueRow?.projectId ?? null;
  if (!projectId) {
    const [pipe] = await db
      .select({ projectId: pipeline.projectId })
      .from(pipeline)
      .where(eq(pipeline.id, run.pipelineId));
    projectId = pipe?.projectId ?? null;
  }
  const routing = projectId
    ? await routingResolver.resolve(stage.id, projectId)
    : null;

  // Persona (optional)
  let personaRow: (typeof persona.$inferSelect & { brandEntry?: typeof brand.$inferSelect | null }) | null = null;
  if (stage.personaId) {
    const [p] = await db
      .select()
      .from(persona)
      .where(eq(persona.id, stage.personaId));
    if (p) {
      let brandRow: typeof brand.$inferSelect | null = null;
      if (p.brandId) {
        const [b] = await db
          .select()
          .from(brand)
          .where(eq(brand.id, p.brandId));
        brandRow = b ?? null;
      }
      personaRow = { ...p, brandEntry: brandRow };
    }
  }

  // ── Materialize + Build + Spawn ──────────────────────────────────

  // Read contextLayout from harness config
  const contextLayout = (harnessRow.contextLayout as { instructionsFile: string; contextFile: string }) ?? {
    instructionsFile: 'CLAUDE.md',
    contextFile: 'context.md',
  };

  const workspacePath = await materialize({
    stageRunId: sRun.id,
    contextLayout,
    persona: personaRow
      ? {
          soul: personaRow.soul,
          identity: personaRow.identity,
          brandToneOfVoice: personaRow.brandEntry?.toneOfVoice,
          brandStyleGuide: personaRow.brandEntry?.styleGuide,
        }
      : null,
    skill: {
      name: skillRow?.name ?? stage.name,
      promptTemplate: skillRow?.promptTemplate ?? null,
    },
    issue: issueRow
      ? {
          number: issueRow.number,
          title: issueRow.title,
          bodyMd: issueRow.bodyMd,
        }
      : { number: 0, title: 'No issue context' },
  });

  try {
    // Build prompt
    const template =
      harnessRow.issuePromptTemplate ?? '{{skill_name}}: {{issue_title}}';
    const prompt = renderTemplate(template, {
      issue_number: issueRow?.number,
      issue_title: issueRow?.title ?? '',
      issue_description: issueRow?.bodyMd ?? '',
      skill_name: skillRow?.name ?? stage.name,
      workspace_path: workspacePath,
    });

    // Build command
    const cmd = buildCommand(harnessRow, {
      model: routing?.modelIdentifier ?? '',
      workspacePath,
      prompt,
      sessionName: `fluxaos-${sRun.id.slice(0, 8)}`,
    });

    // Mark running
    await runService.updateStageRunStatus(sRun.id, STAGE_RUN_STATUS.running);

    // STAGE_STARTED event
    await runService.appendEvent(sRun.id, EVENT_TYPE.launched, {
      provider: routing?.providerName,
      model: routing?.modelIdentifier,
      harness: harnessRow.name,
      skill: skillRow?.name,
      attempt: sRun.attempt,
    });

    // Issue event
    if (run.issueId) {
      await runService.appendIssueEvent(
        run.issueId,
        ISSUE_EVENT_TYPE.stage_started,
        {
          stageRunId: sRun.id,
          stageName: stage.name,
          skillName: skillRow?.name,
          harness: harnessRow.name,
          attempt: sRun.attempt,
        },
        'stage-runner',
      );
    }

    // Spawn subprocess
    let lineNumber = 0;
    let lastSignal: SkillSignal | null = null;
    const lineParser = getParser(harnessRow.outputFormat as string);

    const result = await executor.execute({
      command: cmd.binary,
      args: cmd.args,
      cwd: process.cwd(),
      env: cmd.env,
      timeoutMs: (stage.timeoutSec ?? DEFAULT_STAGE_TIMEOUT_SEC) * 1000,
      onStdout: (data: string) => {
        const lines = data.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;

          // Check for flux:signal — hold in memory, don't store as event
          try {
            const signal = parseSignalLine(line);
            if (signal) {
              lastSignal = signal;
              continue;
            }
          } catch (err) {
            // Invalid signal — store the error as an event and continue
            lineNumber++;
            runService
              .appendEvent(sRun.id, EVENT_TYPE.error, {
                lineNumber,
                content: err instanceof Error ? err.message : String(err),
                kind: 'system',
              })
              .catch(logError);
            continue;
          }

          // Normal output — parse and store immediately
          lineNumber++;
          const entries = lineParser(line, lineNumber);
          for (const entry of entries) {
            runService
              .appendEvent(sRun.id, EVENT_TYPE.output, {
                ...entry,
                content: entry.text ?? entry.toolCommand ?? entry.toolOutput ?? '',
              })
              .catch(logError);
          }
        }
      },
      onStderr: (data: string) => {
        lineNumber++;
        runService
          .appendEvent(sRun.id, EVENT_TYPE.output, {
            lineNumber,
            content: data.trim(),
            kind: 'raw',
            isStderr: true,
          })
          .catch(logError);
      },
    });

    // ── Completion with signal handling ──────────────────────────────

    // No signal emitted → fail the stage
    if (!lastSignal) {
      await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {
        provider: routing?.providerName,
        model: routing?.modelIdentifier,
        harness: harnessRow.name,
        trigger: ctx.trigger,
        errorMessage: 'no skill signal emitted',
      });

      await runService.appendEvent(sRun.id, EVENT_TYPE.error, {
        message: 'no skill signal emitted — skills must output a {"flux:signal": ...} line',
        exitCode: result.exitCode,
      });

      // Issue event for failure
      if (run.issueId) {
        await runService.appendIssueEvent(
          run.issueId,
          ISSUE_EVENT_TYPE.stage_failed,
          {
            stageRunId: sRun.id,
            stageName: stage.name,
            reason: 'no skill signal emitted',
          },
          'stage-runner',
        );
      }

      await cleanup(workspacePath);

      return {
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stageName: stage.name,
        harnessName: harnessRow.name,
        providerName: routing?.providerName ?? null,
        modelIdentifier: routing?.modelIdentifier ?? null,
        issueId: run.issueId,
        stageId: stage.id,
        skillSignal: null,
        skillMetadata: null,
      };
    }

    // Signal was emitted — use it
    const finalStatus = result.exitCode === 0
      ? STAGE_RUN_STATUS.completed
      : STAGE_RUN_STATUS.failed;

    // Build skill metadata from signal
    const skillMetadata: Record<string, unknown> = {};
    if (lastSignal.summary) skillMetadata.summary = lastSignal.summary;
    if (lastSignal.meta) Object.assign(skillMetadata, lastSignal.meta);

    await runService.completeStageRun(sRun.id, finalStatus, {
      provider: routing?.providerName,
      model: routing?.modelIdentifier,
      harness: harnessRow.name,
      costUsd: lastSignal.costUsd?.toFixed(6),
      tokensIn: lastSignal.tokensIn,
      tokensOut: lastSignal.tokensOut,
      skillSignal: lastSignal.verdict,
      skillMetadata: Object.keys(skillMetadata).length > 0 ? skillMetadata : undefined,
      trigger: ctx.trigger,
      errorMessage: result.exitCode !== 0
        ? `exit code ${result.exitCode}`
        : undefined,
    });

    // Completion event
    const eventType = result.exitCode === 0
      ? EVENT_TYPE.completed
      : EVENT_TYPE.error;
    await runService.appendEvent(sRun.id, eventType, {
      exitCode: result.exitCode,
      duration: result.durationMs,
      skillSignal: lastSignal.verdict,
      summary: lastSignal.summary,
    });

    // Issue events
    if (run.issueId) {
      const issueEventType = result.exitCode === 0
        ? ISSUE_EVENT_TYPE.stage_completed
        : ISSUE_EVENT_TYPE.stage_failed;
      await runService.appendIssueEvent(
        run.issueId,
        issueEventType,
        {
          stageRunId: sRun.id,
          stageName: stage.name,
          exitCode: result.exitCode,
          skillSignal: lastSignal.verdict,
        },
        'stage-runner',
      );
    }

    // Cleanup workspace
    await cleanup(workspacePath);

    return {
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stageName: stage.name,
      harnessName: harnessRow.name,
      providerName: routing?.providerName ?? null,
      modelIdentifier: routing?.modelIdentifier ?? null,
      issueId: run.issueId,
      stageId: stage.id,
      skillSignal: lastSignal.verdict,
      skillMetadata: Object.keys(skillMetadata).length > 0 ? skillMetadata : null,
    };
  } catch (err) {
    // Subprocess error (timeout, signal, etc.)
    await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {
      harness: harnessRow.name,
      trigger: ctx.trigger,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    await runService.appendEvent(sRun.id, EVENT_TYPE.error, {
      message: err instanceof Error ? err.message : String(err),
    });
    await cleanup(workspacePath).catch(logError);

    throw err; // Re-throw so caller can handle pipeline-level failure
  }
}

function logError(err: unknown): void {
  console.error('[stage-runner]', err);
}
