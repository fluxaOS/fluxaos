/**
 * Event-Driven Orchestrator — the systemd-managed pipeline state machine.
 *
 * Subscribes to Realtime for pipeline_run and stage_run changes.
 * Reads all config from DB. Writes all state via PipelineRunService.
 * The driver never touches the database.
 *
 * State machine:
 *   pipeline_run created → read first stage → create stage_run
 *   stage_run queued → executeStageRun → running → completed/failed
 *   stage_run completed → evaluate gate → verdict determines next state
 *   stage_run failed → check retry budget → retry or fail permanently
 *   all stages done → complete pipeline_run → write issue events
 */
import { and, eq } from 'drizzle-orm';
import type { FluxaosConfig } from '@/config/env';
import type { GateMode } from '@/core/constants';
import {
  DEFAULT_GATE_MODE,
  EVENT_TYPE,
  GATE_MODE,
  GATE_VERDICT,
  ISSUE_EVENT_TYPE,
  PIPELINE_RUN_STATUS,
  STAGE_RUN_STATUS,
  TRIGGER_TYPE,
} from '@/core/constants';
import type { Database } from '@/core/db/connection';
import {
  driver,
  issue,
  persona,
  pipeline,
  type pipelineRun,
  pipelineStage,
  project,
  skill,
  stageRun,
} from '@/core/db/schema';
import type { Unsubscribe } from '@/core/ports/auth';
import type { GitOpsPort } from '@/core/ports/git';
import type { IsolationProvider } from '@/core/ports/isolation';
import type { RealtimeProvider } from '@/core/ports/realtime';
import type { StageExecutor } from '@/core/ports/stage-executor';
import { createIssueService } from '@/core/services/issue';
import { createPipelineRunService } from './pipeline-run-service';
import type { PipelineTerminalHook } from './pipeline-terminal-hook';

export interface EventOrchestratorConfig {
  maxConcurrentRuns: number;
}

const DEFAULT_CONFIG: EventOrchestratorConfig = {
  maxConcurrentRuns: 5,
};

export interface EventOrchestrator {
  start(): void;
  stop(): void;
  recoverOnStartup(): Promise<void>;
  readonly running: boolean;
}

export function createEventOrchestrator(
  db: Database,
  executor: StageExecutor,
  realtime: RealtimeProvider,
  isolation: IsolationProvider,
  terminalHook: PipelineTerminalHook,
  config: Partial<EventOrchestratorConfig> = {},
  fluxaosConfig?: FluxaosConfig,
  gitOps?: GitOpsPort
): EventOrchestrator {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const runService = createPipelineRunService(db);

  /**
   * Mark a pipeline_run terminal AND trigger the T16 hook (deploy on
   * completed, env-release on everything else). Centralized so every code
   * path that flips the run's status goes through the same hook.
   */
  async function finishRun(
    run: typeof pipelineRun.$inferSelect,
    status: (typeof PIPELINE_RUN_STATUS)[keyof typeof PIPELINE_RUN_STATUS]
  ): Promise<void> {
    await runService.completeRun(run.id, status);

    const projectId = await resolveProjectIdForRun(db, run);

    await terminalHook.onTerminal({
      runId: run.id,
      projectId,
      status,
    });
  }

  let unsubscribeInsert: Unsubscribe | null = null;
  let unsubscribeUpdate: Unsubscribe | null = null;
  let isRunning = false;

  // ─── Realtime Subscription ──────────────────────────────────────────

  function start(): void {
    if (isRunning) return;
    isRunning = true;

    unsubscribeInsert = realtime.subscribeToTable(
      'orchestrator-insert',
      'pipeline_run',
      'INSERT',
      (payload) => {
        const row = payload.new as typeof pipelineRun.$inferSelect;
        if (row.status === PIPELINE_RUN_STATUS.pending) {
          handleNewRun(row.id).catch(logError('handleNewRun'));
        }
      }
    );

    unsubscribeUpdate = realtime.subscribeToTable(
      'orchestrator-update',
      'pipeline_run',
      'UPDATE',
      (payload) => {
        const row = payload.new as typeof pipelineRun.$inferSelect;
        if (row.status === PIPELINE_RUN_STATUS.pending) {
          handleNewRun(row.id).catch(logError('handleNewRun'));
        }
      }
    );
  }

  function stop(): void {
    isRunning = false;
    unsubscribeInsert?.();
    unsubscribeInsert = null;
    unsubscribeUpdate?.();
    unsubscribeUpdate = null;
  }

  function logError(context: string) {
    return (err: unknown) => {
      console.error(`[orchestrator:${context}]`, err);
    };
  }

  // ─── Pipeline Handlers ──────────────────────────────────────────────

  async function handleNewRun(runId: string): Promise<void> {
    const run = await runService.getRun(runId);
    if (!run || run.status !== PIPELINE_RUN_STATUS.pending) return;

    // Check concurrency limit
    const running = await runService.getRunningRuns();
    if (running.length >= cfg.maxConcurrentRuns) return;

    // Get stages
    const stages = await runService.getStages(run.pipelineId);
    if (stages.length === 0) {
      await runService.updateRunStatus(runId, PIPELINE_RUN_STATUS.failed);
      return;
    }

    // Mark running
    await runService.updateRunStatus(runId, PIPELINE_RUN_STATUS.running);

    // Respect a user-specified stage: the tRPC trigger path creates a
    // stage_run at status='pending' (pipeline-run-service default) with
    // the stage the operator clicked. Daemon-autonomous runs have no
    // pre-seeded stage_run and fall back to stages[0]. Reuse the seed
    // row instead of creating a duplicate stage_run.
    const existingStageRuns = await runService.getStageRuns(run.id);
    const pendingSeed = existingStageRuns.find(
      (sr) => sr.status === STAGE_RUN_STATUS.pending
    );
    if (pendingSeed) {
      const seedStage = stages.find(
        (s) => s.id === pendingSeed.pipelineStageId
      );
      if (seedStage) {
        await launchStage(run, seedStage, pendingSeed);
        return;
      }
    }
    await launchStage(run, stages[0]);
  }

  // ─── Stage Execution ────────────────────────────────────────────────

  async function launchStage(
    run: typeof pipelineRun.$inferSelect,
    stage: typeof pipelineStage.$inferSelect,
    preExisting?: typeof stageRun.$inferSelect
  ): Promise<void> {
    // Reuse a pre-existing queued stage_run (trigger-path seed) rather
    // than creating a duplicate row. Autonomous starts have no seed and
    // fall through to createStageRun.
    const sRun =
      preExisting ?? (await runService.createStageRun(run.id, stage.id));

    // Evaluate pre-gate
    const gateMode = (stage.gateMode ?? DEFAULT_GATE_MODE) as GateMode;
    if (gateMode === GATE_MODE.hold || gateMode === GATE_MODE.manual) {
      await runService.updateStageRunStatus(sRun.id, STAGE_RUN_STATUS.pending);
      await runService.appendEvent(sRun.id, EVENT_TYPE.gate_checked, {
        verdict: GATE_VERDICT.hold,
        reason: `gate mode: ${gateMode}`,
      });
      if (run.issueId) {
        await runService.appendIssueEvent(
          run.issueId,
          ISSUE_EVENT_TYPE.gate_hold,
          {
            stageRunId: sRun.id,
            stageName: stage.name,
            verdict: GATE_VERDICT.hold,
            reason: `gate mode: ${gateMode}`,
          },
          'orchestrator'
        );
      }
      return;
    }

    // ── DB-driven execution path ─────────────────────────────────────
    {
      const [pipelineRow] = await db
        .select({ projectId: pipeline.projectId })
        .from(pipeline)
        .where(eq(pipeline.id, run.pipelineId));

      if (!pipelineRow) {
        throw new Error(`Pipeline not found: ${run.pipelineId}`);
      }

      const [driverRow] = stage.driverId
        ? await db.select().from(driver).where(eq(driver.id, stage.driverId))
        : [null];

      if (!driverRow?.binary) {
        console.error(
          `[orchestrator] stage has no driver binary configured (stageRunId: ${sRun.id})`
        );
        await finishRun(run, PIPELINE_RUN_STATUS.failed);
        return;
      }

      const artifactsBase =
        run.artifactsPath ??
        `${fluxaosConfig?.artifactsRoot ?? '.fluxaos-artifacts'}/${run.id}`;
      const resultDocPath = `${artifactsBase}/result.json`;

      // Load persona soul — fail fast if personaId set but not found or empty
      let personaSoul = 'You are a capable AI agent.';
      if (stage.personaId) {
        const [personaRow] = await db
          .select({ soul: persona.soul })
          .from(persona)
          .where(eq(persona.id, stage.personaId));
        if (!personaRow) {
          throw new Error(`Persona not found: ${stage.personaId}`);
        }
        if (!personaRow.soul) {
          throw new Error(
            `Persona soul is empty for persona: ${stage.personaId}`
          );
        }
        personaSoul = personaRow.soul;
      }

      // Load all skills from DB as tool-manual references
      const skillRows = await db
        .select({
          name: skill.name,
          description: skill.description,
          promptTemplate: skill.promptTemplate,
        })
        .from(skill);

      const skills = skillRows.filter(
        (s): s is typeof s & { promptTemplate: string } =>
          s.promptTemplate !== null && s.promptTemplate !== ''
      );

      // Load issue and project context
      const [issueRow] = run.issueId
        ? await db
            .select({ title: issue.title, description: issue.bodyMd })
            .from(issue)
            .where(eq(issue.id, run.issueId))
        : [null];

      const [projectRow] = await db
        .select({ name: project.name })
        .from(project)
        .where(eq(project.id, pipelineRow.projectId));

      const { composePrompt } = await import('@/core/pipeline/prompt-composer');
      const composedPrompt = composePrompt(personaSoul, skills, {
        title: issueRow?.title ?? 'Untitled issue',
        description: issueRow?.description ?? null,
        stageName: stage.name,
        projectName: projectRow?.name ?? 'Unknown project',
        resultDocPath,
        artifactsDir: artifactsBase,
      });

      const transport = driverRow.promptTransport ?? 'argv';
      const driverBinary = driverRow.binary;
      const driverArgs: string[] = [
        ...((driverRow.defaultArgs as string[] | null) ?? []),
      ];

      if (transport === 'argv') {
        driverArgs.push(composedPrompt);
      }

      await runService.updateStageRunStatus(sRun.id, STAGE_RUN_STATUS.running);

      const { runStageGraph } = await import(
        '@/adapters/langgraph/langgraph-stage-runner'
      );
      const { getCheckpointer } = await import(
        '@/adapters/langgraph/checkpoint-store'
      );
      const checkpointer = await getCheckpointer();

      let ingestOutput: string;
      let graphError: string | undefined;

      try {
        const result = await runStageGraph(
          {
            stageRunId: sRun.id,
            resultDocPath,
            artifactsDir: artifactsBase,
            prompt: composedPrompt,
            driverCommand: driverBinary,
            driverArgs,
            env: {
              RESULT_DOC_PATH: resultDocPath,
              ARTIFACTS_DIR: artifactsBase,
            },
            initResultDocScript:
              fluxaosConfig?.initResultDocScript ??
              'src/scripts/pipeline/init-result-doc.ts',
            ingestResultDocScript:
              fluxaosConfig?.ingestResultDocScript ??
              'src/scripts/pipeline/ingest-result-doc.ts',
          },
          checkpointer
        );
        ingestOutput = result.ingestOutput;
        graphError = result.error;
      } catch (err) {
        await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {
          driver: driverBinary,
          trigger: TRIGGER_TYPE.automated,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        await handleStageFailed(run, stage, sRun);
        return;
      }

      if (graphError) {
        await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {
          driver: driverBinary,
          trigger: TRIGGER_TYPE.automated,
          errorMessage: graphError,
        });
        await handleStageFailed(run, stage, sRun);
        return;
      }

      // Parse ingest output to extract verdict and signal info
      let verdict: string = GATE_VERDICT.proceed;
      let signalReason: string | null = null;
      let signalMeta: Record<string, unknown> | null = null;

      try {
        const parsed = JSON.parse(ingestOutput) as {
          verdict?: string;
          signal_reason?: string;
          signal_meta?: Record<string, unknown>;
        };
        if (parsed.verdict === 'pass') verdict = GATE_VERDICT.proceed;
        else if (parsed.verdict === 'fail') verdict = GATE_VERDICT.rework;
        else if (parsed.verdict === 'blocked') verdict = GATE_VERDICT.hold;
        signalReason = parsed.signal_reason ?? null;
        signalMeta = parsed.signal_meta ?? null;
      } catch {
        // ingestOutput not JSON — treat as pass
      }

      await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.completed, {
        driver: driverBinary,
        trigger: TRIGGER_TYPE.automated,
      });

      await applyVerdict(run, stage, sRun, verdict, signalReason, signalMeta);
      return;
    }
  }

  // ─── Verdict Application ────────────────────────────────────────────

  async function applyVerdict(
    run: typeof pipelineRun.$inferSelect,
    stage: typeof pipelineStage.$inferSelect,
    sRun: typeof stageRun.$inferSelect,
    verdict: string,
    signalReason?: string | null,
    signalMeta?: Record<string, unknown> | null
  ): Promise<void> {
    // Map verdict to routing column
    let targetStageName: string | null = null;

    if (verdict === GATE_VERDICT.proceed) {
      targetStageName = stage.onPass ?? null;
    } else if (verdict === GATE_VERDICT.rework) {
      targetStageName = stage.onFail ?? null;
    } else {
      // hold, abort, or anything else → fallback
      targetStageName = stage.fallback ?? null;
    }

    if (!targetStageName) {
      await completePipelineRun(run);
      return;
    }

    if (targetStageName === '__complete__') {
      await completePipelineRun(run);
      return;
    }

    if (targetStageName === '__blocked__') {
      if (run.issueId) {
        const issueService = createIssueService(db);
        const [issueRow] = await db
          .select()
          .from(issue)
          .where(eq(issue.id, run.issueId));
        if (issueRow) {
          const blockedStatusId = await issueService.getStatusIdByConfigKey(
            issueRow.projectId,
            'issues.status.on_blocked_key'
          );
          const question = signalMeta?.question as string | undefined;
          await issueService.updateStatus(
            run.issueId,
            blockedStatusId,
            'orchestrator',
            question
          );
          await runService.appendIssueEvent(
            run.issueId,
            ISSUE_EVENT_TYPE.status_changed,
            { reason: signalReason ?? 'blocked', question },
            'orchestrator'
          );
        }
      }
      await finishRun(run, PIPELINE_RUN_STATUS.blocked);
      return;
    }

    // Find next stage by name in this pipeline
    const [nextStage] = await db
      .select()
      .from(pipelineStage)
      .where(
        and(
          eq(pipelineStage.pipelineId, run.pipelineId),
          eq(pipelineStage.name, targetStageName)
        )
      );

    if (!nextStage) {
      throw new Error(
        `Routing target stage '${targetStageName}' not found in pipeline ${run.pipelineId} (verdict: ${verdict})`
      );
    }

    await launchStage(run, nextStage);
  }

  async function handleStageFailed(
    run: typeof pipelineRun.$inferSelect,
    stage: typeof pipelineStage.$inferSelect,
    sRun: typeof stageRun.$inferSelect
  ): Promise<void> {
    const maxRetries = stage.maxRetries ?? 0;
    if (sRun.attempt < maxRetries + 1) {
      await launchStage(run, stage);
    } else {
      await finishRun(run, PIPELINE_RUN_STATUS.failed);
      if (run.issueId) {
        await runService.appendIssueEvent(
          run.issueId,
          ISSUE_EVENT_TYPE.pipeline_failed,
          {
            pipelineRunId: run.id,
            reason: `Stage failed after ${sRun.attempt} attempt(s)`,
            failedStage: stage.name,
          },
          'orchestrator'
        );
      }
    }
  }

  async function completePipelineRun(
    run: typeof pipelineRun.$inferSelect
  ): Promise<void> {
    await finishRun(run, PIPELINE_RUN_STATUS.completed);
    if (run.issueId) {
      await runService.appendIssueEvent(
        run.issueId,
        ISSUE_EVENT_TYPE.pipeline_completed,
        { pipelineRunId: run.id },
        'orchestrator'
      );
    }
  }

  // ─── Crash Recovery ─────────────────────────────────────────────────

  async function recoverOnStartup(): Promise<void> {
    const staleRuns = await db
      .select()
      .from(stageRun)
      .where(eq(stageRun.status, STAGE_RUN_STATUS.running));

    for (const sRun of staleRuns) {
      const alive = sRun.pid ? isProcessAlive(sRun.pid) : false;

      if (!alive) {
        const [stage] = await db
          .select()
          .from(pipelineStage)
          .where(eq(pipelineStage.id, sRun.pipelineStageId));

        if (!stage) {
          await runService.completeStageRun(
            sRun.id,
            STAGE_RUN_STATUS.failed,
            {}
          );
          continue;
        }

        await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {});
        await runService.appendEvent(sRun.id, EVENT_TYPE.error, {
          message: 'Process died — crash recovery',
          attempt: sRun.attempt,
        });

        const maxRetries = stage.maxRetries ?? 0;
        if (sRun.attempt < maxRetries + 1) {
          const run = await runService.getRun(sRun.pipelineRunId);
          if (run) {
            await launchStage(run, stage);
          }
        } else {
          const run = await runService.getRun(sRun.pipelineRunId);
          if (run) {
            await finishRun(run, PIPELINE_RUN_STATUS.failed);
          } else {
            await runService.completeRun(
              sRun.pipelineRunId,
              PIPELINE_RUN_STATUS.failed
            );
          }
        }
      }
    }
  }

  function isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  return {
    start,
    stop,
    recoverOnStartup,
    get running() {
      return isRunning;
    },
  };
}

/**
 * Resolve a pipeline_run's projectId via its issue (preferred) or its
 * pipeline row (fallback). Used by the terminal hook to locate the
 * isolation env for non-completed terminal statuses.
 */
async function resolveProjectIdForRun(
  db: Database,
  run: typeof pipelineRun.$inferSelect
): Promise<string | null> {
  if (run.issueId) {
    const [issueRow] = await db
      .select()
      .from(issue)
      .where(eq(issue.id, run.issueId));
    if (issueRow?.projectId) return issueRow.projectId;
  }
  const [pipe] = await db
    .select({ projectId: pipeline.projectId })
    .from(pipeline)
    .where(eq(pipeline.id, run.pipelineId));
  return pipe?.projectId ?? null;
}

