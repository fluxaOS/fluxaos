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
import { registry } from '@/config/registry';
import type { TriggerType } from '@/core/constants';
import {
  DEFAULT_STAGE_TIMEOUT_SEC,
  EVENT_TYPE,
  ISSUE_EVENT_TYPE,
  STAGE_RUN_STATUS,
} from '@/core/constants';
import type { Database } from '@/core/db/connection';
import {
  brand,
  driver,
  issue,
  persona,
  pipelineRun,
  pipelineStage,
  skill,
  stageRun,
} from '@/core/db/schema';
import type { IsolationProvider } from '@/core/ports/isolation';
import type { StageExecutor } from '@/core/ports/stage-executor';
import type { StdoutParser, TranscriptEntry } from '@/core/ports/stdout-parser';
import { materialize } from '@/core/skills/materializer';
import { buildCommand, renderTemplate } from './command-builder';
import type { PipelineRunService } from './pipeline-run-service';
import { createRoutingResolver } from './routing-resolver';
import { parseSignalLine, type SkillSignal } from './signal-parser';
import { acquireIsolationEnv, resolveProjectId } from './stage-runner-env';

export { TargetRepoPathMissingError } from './stage-runner-env';

// ── Types ────────────────────────────────────────────────────────────

export interface StageRunContext {
  db: Database;
  executor: StageExecutor;
  runService: PipelineRunService;
  /**
   * IsolationProvider — responsible for the pipeline-scoped worktree.
   * The stage-runner acquires the env on first stage; the pipeline-terminal
   * hook (T16) is responsible for releasing it.
   */
  isolation: IsolationProvider;
  runId: string;
  stageRunId: string;
  trigger: TriggerType;
}

export interface StageRunResult {
  exitCode: number;
  durationMs: number;
  stageName: string;
  driverName: string;
  providerName: string | null;
  modelIdentifier: string | null;
  issueId: string | null;
  stageId: string;
  skillSignal: string | null;
  skillSignalReason: string | null;
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
  ctx: StageRunContext
): Promise<StageRunResult> {
  const { db, executor, runService, isolation, runId, stageRunId } = ctx;

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
  if (!stage)
    throw new Error(`Pipeline stage not found: ${sRun.pipelineStageId}`);

  // Driver (required)
  let driverRow: typeof driver.$inferSelect | null = null;
  if (stage.driverId) {
    const [h] = await db
      .select()
      .from(driver)
      .where(eq(driver.id, stage.driverId));
    driverRow = h ?? null;
  }
  if (!driverRow) {
    await runService.appendEvent(stageRunId, EVENT_TYPE.error, {
      error: 'No driver configured for stage',
      stageName: stage.name,
    });
    throw new Error(`No driver configured for stage: ${stage.name}`);
  }

  if (!driverRow.outputFormat) {
    throw new Error(
      `Driver '${driverRow.name}' has no output_format configured`
    );
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
    const [i] = await db.select().from(issue).where(eq(issue.id, run.issueId));
    issueRow = i ?? null;
  }

  // Routing
  const routingResolver = createRoutingResolver(db);
  const projectId = await resolveProjectId({
    db,
    issueRow,
    pipelineId: run.pipelineId,
  });
  const routing = projectId
    ? await routingResolver.resolve(stage.id, projectId)
    : null;

  // Persona (optional)
  let personaRow:
    | (typeof persona.$inferSelect & {
        brandEntry?: typeof brand.$inferSelect | null;
      })
    | null = null;
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

  // ── Isolation Env + Materialize + Build + Spawn ─────────────────

  if (!projectId) {
    throw new Error(
      `Stage-runner cannot run without a projectId (runId=${runId}). ` +
        'Both issueRow.projectId and pipeline.projectId resolved to null.'
    );
  }
  const { env } = await acquireIsolationEnv({
    db,
    isolation,
    projectId,
    runId,
    pipelineId: run.pipelineId,
    issueId: run.issueId ?? null,
    issueNumber: issueRow?.number ?? null,
  });

  // Mirror env.artifactsPath onto pipeline_run for observability. Write-once:
  // only set if currently null so stage 2+ re-acquire doesn't clobber. Safe
  // to fire-and-forget — failure here doesn't stop the run.
  if (env.artifactsPath) {
    await db
      .update(pipelineRun)
      .set({ artifactsPath: env.artifactsPath })
      .where(eq(pipelineRun.id, runId))
      .catch(() => undefined);
  }

  // Read contextLayout from driver config
  const contextLayout = (driverRow.contextLayout as {
    instructionsFile: string;
    contextFile: string;
  }) ?? {
    instructionsFile: 'CLAUDE.md',
    contextFile: 'context.md',
  };

  const workspacePath = await materialize({
    stageRunId: sRun.id,
    contextLayout,
    into: env.workingPath,
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
      // DEF-024: render {{artifacts_path}} etc. before materialize() writes CLAUDE.md.
      promptTemplate: skillRow?.promptTemplate
        ? renderTemplate(skillRow.promptTemplate, {
            artifacts_path: env.artifactsPath ?? '',
            workspace_path: env.workingPath,
            skill_name: skillRow.name,
          })
        : null,
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
      driverRow.issuePromptTemplate ?? '{{skill_name}}: {{issue_title}}';
    const prompt = renderTemplate(template, {
      issue_number: issueRow?.number,
      issue_title: issueRow?.title ?? '',
      issue_description: issueRow?.bodyMd ?? '',
      skill_name: skillRow?.name ?? stage.name,
      workspace_path: workspacePath,
      artifacts_path: env.artifactsPath ?? '',
    });

    // Build command
    const cmd = buildCommand(driverRow, {
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
      driver: driverRow.name,
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
          driver: driverRow.name,
          attempt: sRun.attempt,
        },
        'stage-runner'
      );
    }

    // Spawn subprocess
    let lineNumber = 0;
    // Widened type so TS doesn't narrow to `never` after the null-check
    // (lastSignal is mutated inside the onStdout callback)
    let lastSignal = null as SkillSignal | null;
    const lineParser = registry
      .get<StdoutParser>('stdoutParser')
      .getParser(driverRow.outputFormat as string);

    const result = await executor.execute({
      command: cmd.binary,
      args: cmd.args,
      cwd: workspacePath,
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
                id: `sig-err-${lineNumber}`,
                kind: 'system',
                lineNumber,
                text: err instanceof Error ? err.message : String(err),
              } satisfies TranscriptEntry)
              .catch(logError);
            continue;
          }

          // Normal output — parse and store immediately
          lineNumber++;
          const entries = lineParser(line, lineNumber);
          for (const entry of entries) {
            runService
              .appendEvent(sRun.id, EVENT_TYPE.output, { ...entry })
              .catch(logError);
          }
        }
      },
      onStderr: (data: string) => {
        lineNumber++;
        runService
          .appendEvent(sRun.id, EVENT_TYPE.output, {
            id: `stderr-${lineNumber}`,
            kind: 'raw',
            lineNumber,
            text: data.trim(),
            isStderr: true,
          } satisfies TranscriptEntry)
          .catch(logError);
      },
    });

    // ── Completion with signal handling ──────────────────────────────

    // No signal emitted → fail the stage
    if (!lastSignal) {
      await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {
        provider: routing?.providerName,
        model: routing?.modelIdentifier,
        driver: driverRow.name,
        trigger: ctx.trigger,
        errorMessage: 'no skill signal emitted',
      });

      await runService.appendEvent(sRun.id, EVENT_TYPE.error, {
        message:
          'no skill signal emitted — skills must output a {"flux:signal": ...} line',
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
          'stage-runner'
        );
      }

      // Env is pipeline-scoped now — T16's pipeline-terminal hook owns release.

      return {
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        stageName: stage.name,
        driverName: driverRow.name,
        providerName: routing?.providerName ?? null,
        modelIdentifier: routing?.modelIdentifier ?? null,
        issueId: run.issueId,
        stageId: stage.id,
        skillSignal: null,
        skillSignalReason: null,
        skillMetadata: null,
      };
    }

    // Signal was emitted — use it
    const finalStatus =
      result.exitCode === 0
        ? STAGE_RUN_STATUS.completed
        : STAGE_RUN_STATUS.failed;

    // Build skill metadata from signal
    const skillMetadata: Record<string, unknown> = {};
    if (lastSignal.summary) skillMetadata.summary = lastSignal.summary;
    if (lastSignal.meta) Object.assign(skillMetadata, lastSignal.meta);

    await runService.completeStageRun(sRun.id, finalStatus, {
      provider: routing?.providerName,
      model: routing?.modelIdentifier,
      driver: driverRow.name,
      costUsd: lastSignal.costUsd?.toFixed(6),
      tokensIn: lastSignal.tokensIn,
      tokensOut: lastSignal.tokensOut,
      skillSignal: lastSignal.verdict,
      skillMetadata:
        Object.keys(skillMetadata).length > 0 ? skillMetadata : undefined,
      trigger: ctx.trigger,
      errorMessage:
        result.exitCode !== 0 ? `exit code ${result.exitCode}` : undefined,
    });

    // Completion event
    const eventType =
      result.exitCode === 0 ? EVENT_TYPE.completed : EVENT_TYPE.error;
    await runService.appendEvent(sRun.id, eventType, {
      exitCode: result.exitCode,
      duration: result.durationMs,
      skillSignal: lastSignal.verdict,
      summary: lastSignal.summary,
    });

    // Issue events
    if (run.issueId) {
      const issueEventType =
        result.exitCode === 0
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
        'stage-runner'
      );
    }

    // Env is pipeline-scoped — T16's pipeline-terminal hook owns release.

    return {
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      stageName: stage.name,
      driverName: driverRow.name,
      providerName: routing?.providerName ?? null,
      modelIdentifier: routing?.modelIdentifier ?? null,
      issueId: run.issueId,
      stageId: stage.id,
      skillSignal: lastSignal.verdict,
      skillSignalReason: lastSignal.reason ?? null,
      skillMetadata:
        Object.keys(skillMetadata).length > 0 ? skillMetadata : null,
    };
  } catch (err) {
    // Subprocess error (timeout, signal, etc.)
    await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {
      driver: driverRow.name,
      trigger: ctx.trigger,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    await runService.appendEvent(sRun.id, EVENT_TYPE.error, {
      message: err instanceof Error ? err.message : String(err),
    });
    // Do NOT release the env here — T16 decides based on pipeline outcome.

    throw err; // Re-throw so caller can handle pipeline-level failure
  }
}

function logError(err: unknown): void {
  console.error('[stage-runner]', err);
}
