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
import type { TriggerType } from '@/core/constants';
import {
  ACTOR,
  EVENT_TYPE,
  ISSUE_EVENT_TYPE,
  STAGE_RUN_STATUS,
} from '@/core/constants';
import type { Database } from '@/core/db/connection';
import {
  driver,
  issue,
  persona,
  pipelineRun,
  pipelineStage,
  skill,
  stageRun,
} from '@/core/db/schema';
import type { GitOpsPort } from '@/core/ports/git';
import type { IsolationProvider } from '@/core/ports/isolation';
import type { StageExecutor } from '@/core/ports/stage-executor';
import type { StdoutParser, TranscriptEntry } from '@/core/ports/stdout-parser';
import type { WorkspaceMaterializerPort } from '@/core/ports/workspace-materializer';
import {
  cleanup as cleanupMaterializedWorkspace,
  materialize,
} from '@/core/skills/materializer';
import { resolveStageBrand } from './brand-resolver';
import { buildCommand, renderTemplate } from './command-builder';
import type { PipelineRunService } from './pipeline-run-service';
import { createRoutingResolver } from './routing-resolver';
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
  /** Local git operations — injected so core never imports from adapters. */
  gitOps: GitOpsPort;
  /** Output line parser — injected so core never imports from adapters. */
  stdoutParser: StdoutParser;
  /** Workspace filesystem operations — injected so core never imports node:fs. */
  wsMaterializer: WorkspaceMaterializerPort;
  runId: string;
  stageRunId: string;
  trigger: TriggerType;
  /**
   * Absolute path to the on-disk clone of the target repo. Injected from
   * FluxaosConfig so core code never reads process.env directly.
   */
  targetRepoPath?: string;
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
  const {
    db,
    executor,
    runService,
    isolation,
    stdoutParser,
    runId,
    stageRunId,
  } = ctx;

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

  if (!driverRow.issuePromptTemplate) {
    throw new Error(
      `Driver '${driverRow.name}' (${driverRow.id}) is missing issuePromptTemplate. ` +
        'Update the driver row to set issuePromptTemplate; stage-runner does not provide a fallback prompt.'
    );
  }

  // Skill (optional) — stored on stageRun, not pipelineStage
  let skillRow: typeof skill.$inferSelect | null = null;
  if (sRun.skillId) {
    const [s] = await db.select().from(skill).where(eq(skill.id, sRun.skillId));
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
  let personaRow: typeof persona.$inferSelect | null = null;
  if (stage.personaId) {
    const [p] = await db
      .select()
      .from(persona)
      .where(eq(persona.id, stage.personaId));
    personaRow = p ?? null;
  }

  // ── Isolation Env + Materialize + Build + Spawn ─────────────────

  if (!projectId) {
    throw new Error(
      `Stage-runner cannot run without a projectId (runId=${runId}). ` +
        'Both issueRow.projectId and pipeline.projectId resolved to null.'
    );
  }
  if (!routing?.modelIdentifier) {
    throw new Error(
      `No routing model resolved for stage '${stage.name}' (${stage.id}) in project ${projectId}. ` +
        'Configure a healthy provider/model and matching routing rule before running the stage.'
    );
  }
  const { env, projectRow } = await acquireIsolationEnv({
    db,
    isolation,
    gitOps: ctx.gitOps,
    projectId,
    runId,
    pipelineId: run.pipelineId,
    issueId: run.issueId ?? null,
    issueNumber: issueRow?.number ?? null,
    targetRepoPath: ctx.targetRepoPath,
  });

  const resolvedBrand = await resolveStageBrand(db, {
    personaBrandId: personaRow?.brandId ?? null,
    projectBrandId: projectRow.brandId,
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

  // FLX-78: contextLayout must come from the driver row in the DB. No
  // hardcoded fallback in core. Seed/migration owns the default value.
  if (!driverRow.contextLayout) {
    throw new Error(
      `Driver '${driverRow.name}' (${driverRow.id}) is missing contextLayout. ` +
        `Update the driver row to set instructionsFile + contextFile (see seed.ts).`
    );
  }
  const contextLayout = driverRow.contextLayout as {
    instructionsFile: string;
    contextFile: string;
  };

  const targetWorkspacePath = env.workingPath;

  const workspacePath = await materialize({
    stageRunId: sRun.id,
    contextLayout,
    fs: ctx.wsMaterializer,
    persona: personaRow
      ? {
          soul: personaRow.soul,
          identity: personaRow.identity,
          brandToneOfVoice: resolvedBrand?.toneOfVoice,
          brandStyleGuide: resolvedBrand?.styleGuide,
        }
      : resolvedBrand
        ? {
            soul: null,
            identity: null,
            brandToneOfVoice: resolvedBrand.toneOfVoice,
            brandStyleGuide: resolvedBrand.styleGuide,
          }
        : null,
    skill: {
      name: skillRow?.name ?? stage.name,
      // DEF-024: render {{artifacts_path}} etc. before materialize() writes the instructions file.
      promptTemplate: skillRow?.promptTemplate
        ? renderTemplate(skillRow.promptTemplate, {
            artifacts_path: env.artifactsPath ?? '',
            workspace_path: targetWorkspacePath,
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

  const executionStartedAt = Date.now();

  try {
    // Build prompt
    const prompt = renderTemplate(driverRow.issuePromptTemplate, {
      issue_number: issueRow?.number,
      issue_title: issueRow?.title ?? '',
      issue_description: issueRow?.bodyMd ?? '',
      skill_name: skillRow?.name ?? stage.name,
      workspace_path: targetWorkspacePath,
      artifacts_path: env.artifactsPath ?? '',
    });

    // Build command
    const cmd = buildCommand(driverRow, {
      model: routing.modelIdentifier,
      workspacePath,
      prompt,
      sessionName: `fluxaos-${sRun.id.slice(0, 8)}`,
      additionalDirs:
        targetWorkspacePath === workspacePath
          ? undefined
          : [targetWorkspacePath],
    });

    // Resolve provider API key from providerApiKeyRef (e.g. "env:ANTHROPIC_API_KEY")
    // and inject it explicitly so the subprocess executor's allowlist can strip
    // the full process.env without losing the provider credential.
    const resolvedProviderEnv: Record<string, string> = {};
    if (routing.providerApiKeyRef?.startsWith('env:')) {
      const envVarName = routing.providerApiKeyRef.slice(4);
      const keyValue = process.env[envVarName];
      if (keyValue) {
        resolvedProviderEnv[envVarName] = keyValue;
      }
    }

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
        ACTOR.stageRunner
      );
    }

    // Spawn subprocess
    let lineNumber = 0;
    const lineParser = stdoutParser.getParser(driverRow.outputFormat as string);

    const result = await executor.execute({
      command: cmd.binary,
      args: cmd.args,
      cwd: workspacePath,
      env: { ...resolvedProviderEnv, ...cmd.env },
      timeoutMs: stage.timeoutSec * 1000,
      onStart: (_processId, pid) => {
        if (!pid) return;
        runService.recordPid(sRun.id, pid).catch(logError);
      },
      onStdout: (data: string) => {
        const lines = data.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;

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

    const cancelledResult = await buildCancelledResult(
      db,
      sRun.id,
      result.exitCode,
      result.durationMs,
      {
        stageName: stage.name,
        driverName: driverRow.name,
        providerName: routing?.providerName ?? null,
        modelIdentifier: routing?.modelIdentifier ?? null,
        issueId: run.issueId,
        stageId: stage.id,
      }
    );
    if (cancelledResult) return cancelledResult;

    // No signal emitted. Behavior depends on exit_code:
    //   - exit 0:    skill exited cleanly without emitting flux:signal.
    //                Headless skill drivers may finish their task and
    //                exit without running the final
    //                `echo '{"flux:signal":...}'` Bash call. Files were
    //                written, work happened — treat as `proceed` and
    //                attach a warning event so it's still observable.
    //                FLX-81 (2026-04-27): originally hard-failed; now
    //                soft-pass on clean exit.
    //   - exit !=0:  skill crashed / aborted — failure stands.
    const cleanExit = result.exitCode === 0;
    const status = cleanExit
      ? STAGE_RUN_STATUS.completed
      : STAGE_RUN_STATUS.failed;
    const synthSignal = cleanExit ? 'proceed' : null;
    const reason = cleanExit
      ? 'no_signal_clean_exit'
      : 'no skill signal emitted';

    // FLX-92: clean-exit-no-signal counts as `proceed` per FLX-81.
    // Auto-commit any uncommitted worktree changes so the next stage
    // and the deploy bridge see a clean tree.
    if (cleanExit) {
      await autoCommitProceedingStage({
        workingPath: env.workingPath,
        stageName: stage.name,
        stageRunId: sRun.id,
        runService,
        gitOps: ctx.gitOps,
      });
    }

    await runService.completeStageRun(sRun.id, status, {
      provider: routing?.providerName,
      model: routing?.modelIdentifier,
      driver: driverRow.name,
      trigger: ctx.trigger,
      skillSignal: synthSignal ?? undefined,
      errorMessage: cleanExit ? undefined : 'no skill signal emitted',
    });

    await runService.appendEvent(
      sRun.id,
      cleanExit ? EVENT_TYPE.completed : EVENT_TYPE.error,
      {
        message: cleanExit
          ? 'no flux:signal emitted but skill exited 0 — synthesizing proceed (FLX-81)'
          : 'no skill signal emitted — skills must output a {"flux:signal": ...} line',
        exitCode: result.exitCode,
      }
    );

    // Issue event
    if (run.issueId) {
      await runService.appendIssueEvent(
        run.issueId,
        cleanExit
          ? ISSUE_EVENT_TYPE.stage_completed
          : ISSUE_EVENT_TYPE.stage_failed,
        {
          stageRunId: sRun.id,
          stageName: stage.name,
          reason,
          exitCode: result.exitCode,
        },
        ACTOR.stageRunner
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
      skillSignal: synthSignal,
      skillSignalReason: cleanExit ? 'no_signal_clean_exit' : null,
      skillMetadata: null,
    };
  } catch (err) {
    // Subprocess error (timeout, signal, etc.)
    const cancelledResult = await buildCancelledResult(
      db,
      sRun.id,
      130,
      Date.now() - executionStartedAt,
      {
        stageName: stage.name,
        driverName: driverRow.name,
        providerName: routing?.providerName ?? null,
        modelIdentifier: routing?.modelIdentifier ?? null,
        issueId: run.issueId,
        stageId: stage.id,
      }
    );
    if (cancelledResult) return cancelledResult;

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
  } finally {
    await cleanupMaterializedWorkspace(workspacePath, ctx.wsMaterializer).catch(
      logError
    );
  }
}

function logError(err: unknown): void {
  console.error('[stage-runner]', err);
}

/**
 * FLX-182: Check whether the stage run was cancelled and, if so, build the
 * standardised cancelled result. Returns the result when the run's current
 * status is `cancelled`, or `null` when it is not.
 *
 * Called from both the success path and the catch block of executeStageRun so
 * the DB select + result shape are not duplicated.
 */
async function buildCancelledResult(
  db: Database,
  stageRunId: string,
  exitCode: number,
  durationMs: number,
  context: {
    stageName: string;
    driverName: string;
    providerName: string | null;
    modelIdentifier: string | null;
    issueId: string | null;
    stageId: string;
  }
): Promise<StageRunResult | null> {
  const [latestStageRun] = await db
    .select({ status: stageRun.status })
    .from(stageRun)
    .where(eq(stageRun.id, stageRunId));
  if (latestStageRun?.status !== STAGE_RUN_STATUS.cancelled) {
    return null;
  }
  return {
    exitCode,
    durationMs,
    stageName: context.stageName,
    driverName: context.driverName,
    providerName: context.providerName,
    modelIdentifier: context.modelIdentifier,
    issueId: context.issueId,
    stageId: context.stageId,
    skillSignal: 'abort',
    skillSignalReason: 'cancelled',
    skillMetadata: null,
  };
}

/**
 * FLX-92: auto-commit any uncommitted changes left in the worktree by the
 * stage worker. The implement skill (and any future driver-bound skill)
 * may write files without running `git add` + `git commit` itself; review
 * and deploy stages need a clean tree to operate against.
 *
 * Only fires when the verdict is `proceed` — `hold`, `rework`, `abort`,
 * and `failed` runs leave the worktree dirty for human inspection or
 * stage retry.
 *
 * Safe to call when nothing changed: `commitAll` short-circuits via
 * `git status --porcelain` and returns `{ noChanges: true }`.
 *
 * Commit message is engine-generated and vendor-agnostic — `<stage_name>:
 * stage_run <id_short>` so the forensic trail leads back to the
 * specific run that produced the work.
 */
async function autoCommitProceedingStage(args: {
  workingPath: string;
  stageName: string;
  stageRunId: string;
  runService: PipelineRunService;
  gitOps: GitOpsPort;
}): Promise<{ committed: boolean; sha: string | null }> {
  const message = `${args.stageName}: stage_run ${args.stageRunId.slice(0, 8)}`;
  const result = await args.gitOps.commitAll(args.workingPath, message);
  if (result.noChanges || !result.commitSha) {
    return { committed: false, sha: null };
  }
  const sha = result.commitSha;
  await args.runService.appendEvent(args.stageRunId, EVENT_TYPE.completed, {
    message: `auto-committed worktree changes (FLX-92): ${sha.slice(0, 8)}`,
    commitSha: sha,
  });
  return { committed: true, sha };
}
