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
  pipeline,
  type pipelineRun,
  pipelineStage,
  stageRun,
} from '@/core/db/schema';
import { createGateService } from '@/core/gates/service';
import type { Unsubscribe } from '@/core/ports/auth';
import type { IsolationProvider } from '@/core/ports/isolation';
import type { RealtimeProvider } from '@/core/ports/realtime';
import type { StageExecutor } from '@/core/ports/stage-executor';
import { createIssueService } from '@/core/services/issue';
import { createPipelineRunService } from './pipeline-run-service';
import type { PipelineTerminalHook } from './pipeline-terminal-hook';
import { executeStageRun } from './stage-runner';

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
  config: Partial<EventOrchestratorConfig> = {}
): EventOrchestrator {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const runService = createPipelineRunService(db);
  const gateService = createGateService(db);

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

    // ── Playbook execution path ──────────────────────────────────────
    // Branch on playbookPath on the pipeline row. Old pipelines (null) fall through.
    {
      const [pipelineRow] = await db
        .select({
          playbookPath: pipeline.playbookPath,
          projectId: pipeline.projectId,
        })
        .from(pipeline)
        .where(eq(pipeline.id, run.pipelineId));

      if (pipelineRow?.playbookPath) {
        const { isParallelGroup, isLoopNode } = await import(
          '@/core/pipeline/playbook'
        );
        const { resolvePlaybook } = await import(
          '@/core/pipeline/playbook-discovery'
        );
        const { auditResultDoc } = await import(
          '@/core/pipeline/playbook-auditor'
        );
        const { executePaperwork } = await import(
          '@/core/pipeline/paperwork-executor'
        );
        const { runStageGraph } = await import(
          '@/core/pipeline/langgraph-stage-runner'
        );
        const { getCheckpointer } = await import(
          '@/core/pipeline/checkpoint-store'
        );
        const { composePrompt } = await import(
          '@/core/pipeline/prompt-composer'
        );
        const { readFileSync, existsSync } = await import('node:fs');
        const { join } = await import('node:path');

        const bundledDir =
          process.env.FLUXAOS_BUNDLED_PIPELINES_DIR ??
          'src/core/pipeline/bundled';
        const discovered = await resolvePlaybook(pipelineRow.playbookPath, {
          bundledDir,
        });

        if (discovered) {
          const playbookStage = discovered.playbook.stages.find(
            (s) => s.id === stage.name
          );

          if (playbookStage && isParallelGroup(playbookStage)) {
            throw new Error(
              `NotImplementedError: parallel group execution is not yet supported (stage: ${stage.name})`
            );
          }

          const [driverRow] = stage.driverId
            ? await db
                .select()
                .from(driver)
                .where(eq(driver.id, stage.driverId))
            : [null];

          const artifactsBase =
            run.artifactsPath ??
            `${process.env.FLUXAOS_ARTIFACTS_ROOT ?? '.fluxaos-artifacts'}/${run.id}`;
          const resultDocPath = `${artifactsBase}/result.json`;

          // Read skill prompt from bundled skills directory
          const skillName =
            playbookStage?.type === 'sequential' ||
            playbookStage?.type === 'loop'
              ? playbookStage.skill
              : stage.name;
          const skillFilePath = join(bundledDir, 'skills', `${skillName}.md`);
          const skillPrompt = existsSync(skillFilePath)
            ? readFileSync(skillFilePath, 'utf-8')
            : '';

          const composedPrompt = composePrompt(
            discovered.playbook.prompt,
            skillPrompt,
            {
              RESULT_DOC_PATH: resultDocPath,
              ARTIFACTS_DIR: artifactsBase,
            }
          );

          if (!driverRow?.binary) {
            console.error(
              `[orchestrator] playbook stage has no driver binary configured (stageRunId: ${sRun.id})`
            );
            await finishRun(run, PIPELINE_RUN_STATUS.failed);
            return;
          }

          const transport = driverRow.promptTransport ?? 'argv';
          const driverBinary = driverRow.binary;
          const driverArgs: string[] = [
            ...((driverRow.defaultArgs as string[] | null) ?? []),
          ];

          if (transport === 'argv') {
            driverArgs.push(composedPrompt);
          }
          // stdin and file transports deferred — only argv is wired now

          await runService.updateStageRunStatus(
            sRun.id,
            STAGE_RUN_STATUS.running
          );

          let ingestOutput: string;
          let graphError: string | undefined;

          if (playbookStage && isLoopNode(playbookStage)) {
            const { runLoopExecutor } = await import(
              '@/core/agents/loop-executor'
            );
            const loopResult = await runLoopExecutor({
              stageRunId: sRun.id,
              resultDocPath,
              artifactsDir: artifactsBase,
              prompt: composedPrompt,
              driverCommand: driverBinary,
              driverArgs,
              until: playbookStage.until,
              maxIterations: playbookStage.maxIterations,
              env: {
                RESULT_DOC_PATH: resultDocPath,
                ARTIFACTS_DIR: artifactsBase,
              },
            });

            ingestOutput = loopResult.lastIngestOutput;
            graphError = loopResult.error;

            // Map loop outcome to audit targetState before the shared audit path
            if (!loopResult.error) {
              const loopTargetState = loopResult.completed
                ? playbookStage.onComplete
                : playbookStage.onExhausted;
              const loopIsTerminal = !discovered.playbook.stages.some(
                (s) => s.id === loopTargetState
              );

              if (run.issueId) {
                await executePaperwork({
                  issueId: run.issueId,
                  projectId: pipelineRow.projectId,
                  db,
                  audit: {
                    action: 'transition',
                    targetState: loopTargetState,
                  },
                });
              }

              const loopStageStatus =
                loopTargetState === 'blocked'
                  ? STAGE_RUN_STATUS.failed
                  : STAGE_RUN_STATUS.completed;
              await runService.completeStageRun(sRun.id, loopStageStatus, {});

              if (loopIsTerminal) {
                const pipelineStatus =
                  loopTargetState === 'blocked'
                    ? PIPELINE_RUN_STATUS.blocked
                    : PIPELINE_RUN_STATUS.completed;
                if (pipelineStatus === PIPELINE_RUN_STATUS.completed) {
                  await completePipelineRun(run);
                } else {
                  await finishRun(run, pipelineStatus);
                }
              } else {
                const nextStage = await db
                  .select()
                  .from(pipelineStage)
                  .where(
                    and(
                      eq(pipelineStage.pipelineId, run.pipelineId),
                      eq(pipelineStage.name, loopTargetState)
                    )
                  )
                  .then((rows) => rows[0] ?? null);

                if (nextStage) {
                  await launchStage(run, nextStage);
                } else {
                  await finishRun(run, PIPELINE_RUN_STATUS.failed);
                }
              }

              return; // skip legacy signal routing
            }

            // error path falls through to shared error handling below
          } else {
            const checkpointer = await getCheckpointer();
            const graphResult = await runStageGraph(
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
              },
              checkpointer
            );
            ingestOutput = graphResult.ingestOutput;
            graphError = graphResult.error;
          }

          if (graphError) {
            await runService.completeStageRun(
              sRun.id,
              STAGE_RUN_STATUS.failed,
              {}
            );
            await finishRun(run, PIPELINE_RUN_STATUS.failed);
            return;
          }

          let ingestResult: { valid: boolean; doc?: Record<string, unknown> };
          try {
            ingestResult = JSON.parse(ingestOutput);
          } catch {
            ingestResult = { valid: false };
          }

          const { isValidResultDoc } = await import(
            '@/core/pipeline/result-doc'
          );
          const resultDoc =
            ingestResult.valid &&
            ingestResult.doc &&
            isValidResultDoc(ingestResult.doc)
              ? ingestResult.doc
              : null;

          const audit = auditResultDoc(
            discovered.playbook,
            stage.name,
            resultDoc
          );
          const isTerminal = !discovered.playbook.stages.some(
            (s) => s.id === audit.targetState
          );

          if (run.issueId) {
            await executePaperwork({
              issueId: run.issueId,
              projectId: pipelineRow.projectId,
              db,
              audit,
            });
          }

          const stageStatus =
            audit.targetState === 'blocked'
              ? STAGE_RUN_STATUS.failed
              : STAGE_RUN_STATUS.completed;
          await runService.completeStageRun(sRun.id, stageStatus, {});

          if (isTerminal) {
            const pipelineStatus =
              audit.targetState === 'blocked'
                ? PIPELINE_RUN_STATUS.blocked
                : PIPELINE_RUN_STATUS.completed;
            if (pipelineStatus === PIPELINE_RUN_STATUS.completed) {
              await completePipelineRun(run);
            } else {
              await finishRun(run, pipelineStatus);
            }
          } else {
            const nextStage = await db
              .select()
              .from(pipelineStage)
              .where(
                and(
                  eq(pipelineStage.pipelineId, run.pipelineId),
                  eq(pipelineStage.name, audit.targetState)
                )
              )
              .then((rows) => rows[0] ?? null);

            if (nextStage) {
              await launchStage(run, nextStage);
            } else {
              await finishRun(run, PIPELINE_RUN_STATUS.failed);
            }
          }

          return; // skip legacy signal routing
        }
      }
    }
    // ── End playbook path — fall through to legacy executeStageRun ────────────

    // Execute the stage via shared stage-runner
    try {
      const result = await executeStageRun({
        db,
        executor,
        runService,
        isolation,
        runId: run.id,
        stageRunId: sRun.id,
        trigger: TRIGGER_TYPE.automated,
      });

      const latestRun = await runService.getRun(run.id);
      const [latestStageRun] = await db
        .select({ status: stageRun.status })
        .from(stageRun)
        .where(eq(stageRun.id, sRun.id));
      if (latestRun?.status === PIPELINE_RUN_STATUS.cancelled) {
        await terminalHook.onTerminal({
          runId: latestRun.id,
          projectId: await resolveProjectIdForRun(db, latestRun),
          status: PIPELINE_RUN_STATUS.cancelled,
        });
        return;
      }
      if (latestStageRun?.status === STAGE_RUN_STATUS.cancelled) {
        await finishRun(run, PIPELINE_RUN_STATUS.cancelled);
        return;
      }

      // Post-execution gate evaluation — always write a result row
      const gateResult = await gateService.evaluateStageGate(
        stage.id,
        sRun.id,
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

      await runService.appendEvent(sRun.id, EVENT_TYPE.gate_checked, {
        verdict: gateResult.verdict,
        passed: gateResult.passed,
        reason: gateResult.reason,
      });

      if (result.exitCode !== 0) {
        // Failed — check retry budget
        await handleStageFailed(run, stage, sRun);
      } else {
        // Use skill signal verdict if present (hold/rework/abort), otherwise gate verdict
        const effectiveVerdict = result.skillSignal ?? gateResult.verdict;
        await applyVerdict(
          run,
          stage,
          sRun,
          effectiveVerdict,
          result.skillSignalReason,
          result.skillMetadata
        );
      }
    } catch (err) {
      // Stage execution threw (timeout, signal, etc.). User cancellation may
      // have raced the subprocess error, so re-read terminal state first.
      const latestRun = await runService.getRun(run.id);
      const [latestStageRun] = await db
        .select({ status: stageRun.status })
        .from(stageRun)
        .where(eq(stageRun.id, sRun.id));
      if (latestRun?.status === PIPELINE_RUN_STATUS.cancelled) {
        await terminalHook.onTerminal({
          runId: latestRun.id,
          projectId: await resolveProjectIdForRun(db, latestRun),
          status: PIPELINE_RUN_STATUS.cancelled,
        });
        return;
      }
      if (latestStageRun?.status === STAGE_RUN_STATUS.cancelled) {
        await finishRun(run, PIPELINE_RUN_STATUS.cancelled);
        return;
      }

      await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {
        driver: stage.driver ?? undefined,
        trigger: TRIGGER_TYPE.automated,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      await handleStageFailed(run, stage, sRun);
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
    if (verdict === GATE_VERDICT.proceed) {
      const nextStage = await runService.getNextStage(
        run.pipelineId,
        stage.sortOrder
      );

      if (nextStage) {
        await launchStage(run, nextStage);
      } else {
        await completePipelineRun(run);
      }
    } else if (verdict === GATE_VERDICT.hold) {
      await runService.updateStageRunStatus(sRun.id, STAGE_RUN_STATUS.pending);

      if (run.issueId) {
        const issueService = createIssueService(db);
        const [issueRow] = await db
          .select()
          .from(issue)
          .where(eq(issue.id, run.issueId));

        if (issueRow) {
          if (signalReason === 'already_complete') {
            const targetStateKey = signalMeta?.targetState as
              | string
              | undefined;
            if (targetStateKey) {
              const targetState = await issueService.getStateByKey(
                issueRow.projectId,
                targetStateKey
              );
              await issueService.stateOverride(
                run.issueId,
                targetState.id,
                issueRow.version,
                'orchestrator'
              );
              await runService.appendIssueEvent(
                run.issueId,
                ISSUE_EVENT_TYPE.state_changed,
                { reason: 'already_complete', targetState: targetStateKey },
                'orchestrator'
              );
            }
          } else {
            // needs_human or unknown reason — block the issue
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
              { reason: signalReason ?? 'needs_human', question },
              'orchestrator'
            );
          }
        }
      }
    } else if (verdict === GATE_VERDICT.rework) {
      await handleReworkVerdict(run, stage, sRun);
    } else if (verdict === GATE_VERDICT.abort) {
      await finishRun(run, PIPELINE_RUN_STATUS.failed);
      if (run.issueId) {
        await runService.appendIssueEvent(
          run.issueId,
          ISSUE_EVENT_TYPE.pipeline_failed,
          {
            pipelineRunId: run.id,
            reason: 'Gate verdict: abort',
            failedStage: stage.name,
          },
          'orchestrator'
        );
      }
    }
  }

  async function handleReworkVerdict(
    run: typeof pipelineRun.$inferSelect,
    stage: typeof pipelineStage.$inferSelect,
    sRun: typeof stageRun.$inferSelect
  ): Promise<void> {
    if (!run.issueId) {
      await handleStageFailed(run, stage, sRun);
      return;
    }

    const issueService = createIssueService(db);
    const [issueRow] = await db
      .select()
      .from(issue)
      .where(eq(issue.id, run.issueId));
    if (!issueRow) {
      await handleStageFailed(run, stage, sRun);
      return;
    }

    const targetState = await issueService.getStateByConfigKey(
      issueRow.projectId,
      'issues.state.on_rework_key'
    );
    await issueService.stateOverride(
      run.issueId,
      targetState.id,
      issueRow.version,
      'orchestrator'
    );
    await runService.appendIssueEvent(
      run.issueId,
      ISSUE_EVENT_TYPE.state_changed,
      {
        reason: 'gate_rework',
        targetState: targetState.key,
        stageRunId: sRun.id,
      },
      'orchestrator'
    );

    const [reworkStage] = await db
      .select()
      .from(pipelineStage)
      .where(
        and(
          eq(pipelineStage.pipelineId, run.pipelineId),
          eq(pipelineStage.name, targetState.key)
        )
      );

    if (!reworkStage || reworkStage.id === stage.id) {
      await handleStageFailed(run, stage, sRun);
      return;
    }

    await launchStage(run, reworkStage);
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
