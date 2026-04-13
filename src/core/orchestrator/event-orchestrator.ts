/**
 * Event-Driven Orchestrator — the systemd-managed pipeline state machine.
 *
 * Subscribes to Supabase Realtime for pipeline_run and stage_run changes.
 * Reads all config from DB. Writes all state to DB. The harness never
 * touches the database.
 *
 * State machine:
 *   pipeline_run created → read first stage → create stage_run
 *   stage_run queued → materialize → build command → spawn → running
 *   stage_run completed → evaluate gate → verdict determines next state
 *   stage_run failed → check retry budget → retry or fail permanently
 *   stage_run cancelled → do nothing (restart-unless-stopped)
 *   all stages done → complete pipeline_run → transition issue state
 */
import { eq, and, asc, sql } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import type { StageExecutor } from '@/core/ports/stage-executor';
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import {
  pipeline,
  pipelineStage,
  pipelineRun,
  stageRun,
  event,
  issueEvent,
  issue,
  skill,
  harnessCatalog,
  persona,
  brand,
  stageGateResult,
} from '@/core/db/schema';
import { materialize, cleanup } from '@/core/skills/materializer';
import { buildCommand, renderTemplate } from './command-builder';
import { parseLine } from './output-parser';
import { createRoutingResolver } from './routing-resolver';
import { createGateService } from '@/core/gates/service';
import type { GateMode } from '@/core/gates/types';
import { STAGE_RUN_TERMINAL } from './types';

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
  supabase: SupabaseClient,
  config: Partial<EventOrchestratorConfig> = {},
): EventOrchestrator {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const routingResolver = createRoutingResolver(db);
  const gateService = createGateService(db);

  let channel: RealtimeChannel | null = null;
  let isRunning = false;

  // ─── Realtime Subscription ──────────────────────────────────────────

  function start(): void {
    if (isRunning) return;
    isRunning = true;

    channel = supabase
      .channel('orchestrator')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pipeline_run' },
        (payload) => {
          const row = payload.new as typeof pipelineRun.$inferSelect;
          if (row.status === 'pending') {
            handleNewRun(row.id).catch(logError('handleNewRun'));
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pipeline_run' },
        (payload) => {
          const row = payload.new as typeof pipelineRun.$inferSelect;
          if (row.status === 'pending') {
            handleNewRun(row.id).catch(logError('handleNewRun'));
          }
        },
      )
      .subscribe();
  }

  function stop(): void {
    isRunning = false;
    if (channel) {
      supabase.removeChannel(channel);
      channel = null;
    }
  }

  function logError(context: string) {
    return (err: unknown) => {
      console.error(`[orchestrator:${context}]`, err);
    };
  }

  // ─── Pipeline Handlers ──────────────────────────────────────────────

  async function handleNewRun(runId: string): Promise<void> {
    const [run] = await db
      .select()
      .from(pipelineRun)
      .where(eq(pipelineRun.id, runId));
    if (!run || run.status !== 'pending') return;

    // Check concurrency limit
    const running = await db
      .select({ id: pipelineRun.id })
      .from(pipelineRun)
      .where(eq(pipelineRun.status, 'running'));
    if (running.length >= cfg.maxConcurrentRuns) return;

    // Get stages
    const stages = await db
      .select()
      .from(pipelineStage)
      .where(eq(pipelineStage.pipelineId, run.pipelineId))
      .orderBy(asc(pipelineStage.sortOrder));

    if (stages.length === 0) {
      await updateRunStatus(runId, 'failed');
      return;
    }

    // Mark running
    await updateRunStatus(runId, 'running');

    // Launch first stage
    await launchStage(run, stages[0]);
  }

  // ─── Stage Execution ────────────────────────────────────────────────

  async function launchStage(
    run: typeof pipelineRun.$inferSelect,
    stage: typeof pipelineStage.$inferSelect,
  ): Promise<void> {
    // Read skill from DB
    let skillRow: typeof skill.$inferSelect | null = null;
    if (stage.skillId) {
      const [s] = await db
        .select()
        .from(skill)
        .where(eq(skill.id, stage.skillId));
      skillRow = s ?? null;
    }

    // Read harness from DB
    let harnessRow: typeof harnessCatalog.$inferSelect | null = null;
    if (stage.harnessId) {
      const [h] = await db
        .select()
        .from(harnessCatalog)
        .where(eq(harnessCatalog.id, stage.harnessId));
      harnessRow = h ?? null;
    }

    if (!harnessRow) {
      await appendEvent(null, 'error', {
        error: 'No harness configured for stage',
        stageName: stage.name,
      });
      await updateRunStatus(run.id, 'failed');
      return;
    }

    // Read issue
    let issueRow: typeof issue.$inferSelect | null = null;
    if (run.issueId) {
      const [i] = await db
        .select()
        .from(issue)
        .where(eq(issue.id, run.issueId));
      issueRow = i ?? null;
    }

    // Resolve routing
    let projectId: string | null = null;
    if (issueRow) {
      projectId = issueRow.projectId;
    } else {
      const [pipe] = await db
        .select({ projectId: pipeline.projectId })
        .from(pipeline)
        .where(eq(pipeline.id, run.pipelineId));
      projectId = pipe?.projectId ?? null;
    }

    const routing = projectId
      ? await routingResolver.resolve(stage.id, projectId)
      : null;

    // Resolve persona
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

    // Get existing stage runs for attempt counting
    const existingRuns = await db
      .select()
      .from(stageRun)
      .where(
        and(
          eq(stageRun.pipelineRunId, run.id),
          eq(stageRun.pipelineStageId, stage.id),
        ),
      );
    const attempt = existingRuns.length + 1;

    // Create stage_run
    const [sRun] = await db
      .insert(stageRun)
      .values({
        pipelineRunId: run.id,
        pipelineStageId: stage.id,
        status: 'queued',
        attempt,
        provider: routing?.providerName ?? null,
        model: routing?.modelIdentifier ?? null,
        harness: harnessRow.name,
        skillId: skillRow?.id ?? null,
        harnessId: harnessRow.id,
      })
      .returning();

    // Evaluate pre-gate
    const gateMode = (stage.gateMode ?? 'auto') as GateMode;
    if (gateMode === 'hold' || gateMode === 'manual') {
      await db
        .update(stageRun)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(stageRun.id, sRun.id));
      await appendEvent(sRun.id, 'gate_checked', {
        verdict: 'hold',
        reason: `gate mode: ${gateMode}`,
      });
      if (run.issueId) {
        await appendIssueEvent(run.issueId, 'gate_hold', {
          stageRunId: sRun.id,
          stageName: stage.name,
          verdict: 'hold',
          reason: `gate mode: ${gateMode}`,
        });
      }
      return;
    }

    // Execute the stage
    await executeStage(run, stage, sRun, harnessRow, skillRow, issueRow, personaRow, routing);
  }

  async function executeStage(
    run: typeof pipelineRun.$inferSelect,
    stage: typeof pipelineStage.$inferSelect,
    sRun: typeof stageRun.$inferSelect,
    harnessRow: typeof harnessCatalog.$inferSelect,
    skillRow: typeof skill.$inferSelect | null,
    issueRow: typeof issue.$inferSelect | null,
    personaRow: (typeof persona.$inferSelect & { brandEntry?: typeof brand.$inferSelect | null }) | null,
    routing: Awaited<ReturnType<typeof routingResolver.resolve>>,
  ): Promise<void> {
    // 1. Materialize workspace
    const workspacePath = await materialize({
      stageRunId: sRun.id,
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

    // 2. Build prompt from template
    const template =
      harnessRow.issuePromptTemplate ?? '{{skill_name}}: {{issue_title}}';
    const prompt = renderTemplate(template, {
      issue_number: issueRow?.number,
      issue_title: issueRow?.title ?? '',
      issue_description: issueRow?.bodyMd ?? '',
      skill_name: skillRow?.name ?? stage.name,
      workspace_path: workspacePath,
    });

    // 3. Build command
    const cmd = buildCommand(harnessRow, {
      model: routing?.modelIdentifier ?? '',
      workspacePath,
      prompt,
      sessionName: `fluxaos-${sRun.id.slice(0, 8)}`,
    });

    // 4. Update stage_run to running
    const pid = process.pid; // Orchestrator PID for orphan detection
    await db
      .update(stageRun)
      .set({
        status: 'running',
        startedAt: new Date(),
        pid,
        updatedAt: new Date(),
      })
      .where(eq(stageRun.id, sRun.id));

    // 5. Record STAGE_STARTED event + issue_event
    await appendEvent(sRun.id, 'STAGE_STARTED', {
      provider: routing?.providerName,
      model: routing?.modelIdentifier,
      harness: harnessRow.name,
      skill: skillRow?.name,
      attempt: sRun.attempt,
    });
    if (run.issueId) {
      await appendIssueEvent(run.issueId, 'stage_started', {
        stageRunId: sRun.id,
        stageName: stage.name,
        skillName: skillRow?.name,
        harness: harnessRow.name,
        attempt: sRun.attempt,
      });
    }

    // 6. Spawn subprocess
    let lineNumber = 0;
    try {
      const result = await executor.execute({
        command: cmd.binary,
        args: cmd.args,
        cwd: workspacePath,
        env: cmd.env,
        timeoutMs: (stage.timeoutSec ?? 300) * 1000,
        onStdout: (data: string) => {
          // Parse each line and write OUTPUT events
          const lines = data.split('\n');
          for (const line of lines) {
            if (!line.trim()) continue;
            lineNumber++;
            const entries = parseLine(line, lineNumber);
            for (const entry of entries) {
              appendEvent(sRun.id, 'OUTPUT', {
                ...entry,
                content: entry.text ?? entry.toolCommand ?? entry.toolOutput ?? '',
              }).catch(logError('appendOutputEvent'));
            }
          }
        },
        onStderr: (data: string) => {
          lineNumber++;
          appendEvent(sRun.id, 'OUTPUT', {
            lineNumber,
            content: data.trim(),
            kind: 'raw',
            isStderr: true,
          }).catch(logError('appendStderrEvent'));
        },
      });

      // 7. Update stage_run with results
      await db
        .update(stageRun)
        .set({
          status: result.exitCode === 0 ? 'completed' : 'failed',
          completedAt: new Date(),
          exitCode: result.exitCode,
          updatedAt: new Date(),
        })
        .where(eq(stageRun.id, sRun.id));

      // 8. Record completion event
      const finalStatus = result.exitCode === 0 ? 'STAGE_COMPLETED' : 'ERROR';
      await appendEvent(sRun.id, finalStatus, {
        exitCode: result.exitCode,
        duration: result.durationMs,
      });

      // 9. Cleanup workspace
      await cleanup(workspacePath);

      // 10. Evaluate gate
      const gateMode = (stage.gateMode ?? 'auto') as GateMode;
      if (result.exitCode === 0 && gateMode === 'rules') {
        const gateContext: Record<string, unknown> = {
          exit_code: result.exitCode,
          cost_usd: 0,
          tokens_in: 0,
          tokens_out: 0,
          provider: routing?.providerName,
          model: routing?.modelIdentifier,
          harness: harnessRow.name,
        };

        const gateResult = await gateService.evaluateStageGate(
          stage.id,
          sRun.id,
          gateContext,
        );

        await appendEvent(sRun.id, 'GATE_EVALUATED', {
          verdict: gateResult.verdict,
          passed: gateResult.passed,
          reason: gateResult.reason,
        });

        if (run.issueId) {
          await appendIssueEvent(run.issueId, 'stage_completed', {
            stageRunId: sRun.id,
            stageName: stage.name,
            exitCode: result.exitCode,
            verdict: gateResult.verdict,
          });
        }

        // Apply verdict
        await applyVerdict(run, stage, sRun, gateResult.verdict);
      } else if (result.exitCode === 0) {
        // auto/skip gate → proceed
        if (run.issueId) {
          await appendIssueEvent(run.issueId, 'stage_completed', {
            stageRunId: sRun.id,
            stageName: stage.name,
            exitCode: result.exitCode,
            verdict: 'proceed',
          });
        }
        await applyVerdict(run, stage, sRun, 'proceed');
      } else {
        // Failed — check retry budget
        if (run.issueId) {
          await appendIssueEvent(run.issueId, 'stage_failed', {
            stageRunId: sRun.id,
            stageName: stage.name,
            error: `Exit code ${result.exitCode}`,
            attempt: sRun.attempt,
            retriesRemaining: (stage.maxRetries ?? 0) - sRun.attempt,
          });
        }
        await handleStageFailed(run, stage, sRun);
      }
    } catch (err) {
      // Subprocess error (timeout, signal, etc.)
      await db
        .update(stageRun)
        .set({
          status: 'failed',
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(stageRun.id, sRun.id));

      await appendEvent(sRun.id, 'ERROR', {
        message: err instanceof Error ? err.message : String(err),
        attempt: sRun.attempt,
        retriesRemaining: (stage.maxRetries ?? 0) - sRun.attempt,
      });

      await cleanup(workspacePath);
      await handleStageFailed(run, stage, sRun);
    }
  }

  // ─── Verdict Application ────────────────────────────────────────────

  async function applyVerdict(
    run: typeof pipelineRun.$inferSelect,
    stage: typeof pipelineStage.$inferSelect,
    sRun: typeof stageRun.$inferSelect,
    verdict: string,
  ): Promise<void> {
    if (verdict === 'proceed') {
      // Advance to next stage
      const [nextStage] = await db
        .select()
        .from(pipelineStage)
        .where(
          and(
            eq(pipelineStage.pipelineId, run.pipelineId),
            sql`${pipelineStage.sortOrder} > ${stage.sortOrder}`,
          ),
        )
        .orderBy(asc(pipelineStage.sortOrder))
        .limit(1);

      if (nextStage) {
        await launchStage(run, nextStage);
      } else {
        // All stages done
        await completeRun(run);
      }
    } else if (verdict === 'hold') {
      await db
        .update(stageRun)
        .set({ status: 'pending', updatedAt: new Date() })
        .where(eq(stageRun.id, sRun.id));
    } else if (verdict === 'rework') {
      // Retry within budget
      await handleStageFailed(run, stage, sRun);
    } else if (verdict === 'abort') {
      await updateRunStatus(run.id, 'failed');
      if (run.issueId) {
        await appendIssueEvent(run.issueId, 'pipeline_failed', {
          pipelineRunId: run.id,
          reason: 'Gate verdict: abort',
          failedStage: stage.name,
        });
      }
    }
  }

  async function handleStageFailed(
    run: typeof pipelineRun.$inferSelect,
    stage: typeof pipelineStage.$inferSelect,
    sRun: typeof stageRun.$inferSelect,
  ): Promise<void> {
    const maxRetries = stage.maxRetries ?? 0;
    if (sRun.attempt < maxRetries + 1) {
      // Retry — launch a new stage run
      await launchStage(run, stage);
    } else {
      // Budget exhausted — fail the pipeline
      await updateRunStatus(run.id, 'failed');
      if (run.issueId) {
        await appendIssueEvent(run.issueId, 'pipeline_failed', {
          pipelineRunId: run.id,
          reason: `Stage failed after ${sRun.attempt} attempt(s)`,
          failedStage: stage.name,
        });
      }
    }
  }

  async function completeRun(
    run: typeof pipelineRun.$inferSelect,
  ): Promise<void> {
    // Aggregate cost
    const stages = await db
      .select({ costUsd: stageRun.costUsd })
      .from(stageRun)
      .where(eq(stageRun.pipelineRunId, run.id));
    const totalCost = stages.reduce(
      (sum, s) => sum + Number(s.costUsd ?? 0),
      0,
    );

    await db
      .update(pipelineRun)
      .set({
        status: 'completed',
        completedAt: new Date(),
        totalCostUsd: totalCost.toFixed(6),
        updatedAt: new Date(),
      })
      .where(eq(pipelineRun.id, run.id));

    if (run.issueId) {
      await appendIssueEvent(run.issueId, 'pipeline_completed', {
        pipelineRunId: run.id,
        totalCostUsd: totalCost,
      });
    }
  }

  // ─── Crash Recovery ─────────────────────────────────────────────────

  async function recoverOnStartup(): Promise<void> {
    // Find stale "running" stage runs
    const staleRuns = await db
      .select()
      .from(stageRun)
      .where(eq(stageRun.status, 'running'));

    for (const sRun of staleRuns) {
      // Check if the process is still alive
      const alive = sRun.pid ? isProcessAlive(sRun.pid) : false;

      if (!alive) {
        // Process died — check retry budget
        const [stage] = await db
          .select()
          .from(pipelineStage)
          .where(eq(pipelineStage.id, sRun.pipelineStageId));

        if (!stage) {
          await db
            .update(stageRun)
            .set({ status: 'failed', completedAt: new Date(), updatedAt: new Date() })
            .where(eq(stageRun.id, sRun.id));
          continue;
        }

        const maxRetries = stage.maxRetries ?? 0;
        if (sRun.attempt < maxRetries + 1) {
          // Within retry budget — mark failed and re-launch
          await db
            .update(stageRun)
            .set({ status: 'failed', completedAt: new Date(), updatedAt: new Date() })
            .where(eq(stageRun.id, sRun.id));

          await appendEvent(sRun.id, 'ERROR', {
            message: 'Process died — crash recovery retry',
            attempt: sRun.attempt,
            retriesRemaining: maxRetries - sRun.attempt,
          });

          const [run] = await db
            .select()
            .from(pipelineRun)
            .where(eq(pipelineRun.id, sRun.pipelineRunId));
          if (run) {
            await launchStage(run, stage);
          }
        } else {
          // Budget exhausted
          await db
            .update(stageRun)
            .set({ status: 'failed', completedAt: new Date(), updatedAt: new Date() })
            .where(eq(stageRun.id, sRun.id));

          await appendEvent(sRun.id, 'ERROR', {
            message: 'Process died — retry budget exhausted',
            attempt: sRun.attempt,
            retriesRemaining: 0,
          });

          await updateRunStatus(sRun.pipelineRunId, 'failed');
        }
      }
      // If alive, we can't re-attach in this architecture — log it
    }

    // Cancelled stage runs are never re-launched (restart-unless-stopped)
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  async function updateRunStatus(
    runId: string,
    status: string,
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };
    if (status === 'running') updates.startedAt = new Date();
    if (STAGE_RUN_TERMINAL.has(status)) updates.completedAt = new Date();
    await db
      .update(pipelineRun)
      .set(updates)
      .where(eq(pipelineRun.id, runId));
  }

  async function appendEvent(
    stageRunId: string | null,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!stageRunId) return;
    await db.insert(event).values({
      stageRunId,
      type,
      payload,
    });
  }

  async function appendIssueEvent(
    issueId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await db.insert(issueEvent).values({
      issueId,
      actor: 'orchestrator',
      type,
      payload,
    });
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
