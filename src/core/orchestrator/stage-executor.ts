/**
 * Stage execution and verdict application logic extracted from event-orchestrator.
 *
 * createStageExecutor returns a launchStage function that executes a single
 * pipeline stage end-to-end: pre-gate check → DB-driven execution → result
 * ingestion → verdict routing (applyVerdict → next launchStage or terminal).
 */
import { and, eq } from 'drizzle-orm';
import type { FluxaosConfig } from '@/config/env';
import type { GateMode } from '@/core/constants';
import {
  ACTOR,
  EVENT_TYPE,
  GATE_MODE,
  GATE_VERDICT,
  ISSUE_EVENT_TYPE,
  PIPELINE_RUN_STATUS,
  PIPELINE_SENTINEL,
  RESULT_DOC_VERDICT,
  STAGE_RUN_STATUS,
  TRIGGER_TYPE,
} from '@/core/constants';
import type { Database } from '@/core/db/connection';
import {
  driver,
  issue,
  persona,
  pipeline,
  pipelineRun,
  pipelineStage,
  project,
  skill,
  stageRun,
} from '@/core/db/schema';
import { IngestOutputSchema } from '@/core/pipeline/result-doc';
import type { GitOpsPort } from '@/core/ports/git';
import type { IsolationProvider } from '@/core/ports/isolation';
import type { StageGraphRunner } from '@/core/ports/stage-graph-runner';
import type { PipelineRunService } from './pipeline-run-service';
import { blockIssueOnRun } from './run-helpers';
import { acquireIsolationEnv } from './stage-runner-env';

export interface StageExecutorDeps {
  db: Database;
  runService: PipelineRunService;
  fluxaosConfig: FluxaosConfig | undefined;
  stageGraphRunner: StageGraphRunner | undefined;
  /**
   * Pipeline-scoped worktree provider. The auto-dispatch path acquires an
   * isolation env on the first stage and reuses it across stages via the
   * provider's re-entrant acquire. The pipeline-terminal hook (T16) owns
   * release. Required — no fallback.
   */
  isolation: IsolationProvider;
  /** Local git operations — required to resolve repoIdentity for acquire. */
  gitOps: GitOpsPort;
  finishRun: (
    run: typeof pipelineRun.$inferSelect,
    status: (typeof PIPELINE_RUN_STATUS)[keyof typeof PIPELINE_RUN_STATUS]
  ) => Promise<void>;
}

export function createStageExecutor(deps: StageExecutorDeps) {
  const {
    db,
    runService,
    fluxaosConfig,
    stageGraphRunner,
    isolation,
    gitOps,
    finishRun,
  } = deps;

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
    const gateMode = stage.gateMode as GateMode;
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
          ACTOR.orchestrator
        );
      }
      return;
    }

    // ── DB-driven execution path ─────────────────────────────────────
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
      const msg = stage.driverId
        ? `stage driver has no binary configured (driverId: ${stage.driverId})`
        : `stage has no driver configured`;
      console.error(`[orchestrator] ${msg} (stageRunId: ${sRun.id})`);
      await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {
        errorMessage: msg,
      });
      await finishRun(run, PIPELINE_RUN_STATUS.failed);
      return;
    }

    // Acquire (or reuse) the pipeline-scoped worktree. The provider is
    // re-entrant: on stage 2..N a second acquire for the same (projectId,
    // runId) returns the existing env, so this block is safe to call once
    // per stage. T16's pipeline-terminal hook owns release.
    let issueNumber: number | null = null;
    if (run.issueId) {
      const [issueNumRow] = await db
        .select({ number: issue.number })
        .from(issue)
        .where(eq(issue.id, run.issueId));
      issueNumber = issueNumRow?.number ?? null;
    }

    let envWorkingPath: string;
    let envArtifactsPath: string | null;
    try {
      const acquired = await acquireIsolationEnv({
        db,
        isolation,
        gitOps,
        projectId: pipelineRow.projectId,
        runId: run.id,
        pipelineId: run.pipelineId,
        issueId: run.issueId ?? null,
        issueNumber,
      });
      envWorkingPath = acquired.env.workingPath;
      envArtifactsPath = acquired.env.artifactsPath;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {
        errorMessage,
      });
      await handleStageFailed(run, stage, sRun);
      return;
    }

    if (!envArtifactsPath) {
      const msg = `isolation provider returned no artifactsPath for run ${run.id}`;
      await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {
        errorMessage: msg,
      });
      await finishRun(run, PIPELINE_RUN_STATUS.failed);
      return;
    }

    if (!run.artifactsPath) {
      await db
        .update(pipelineRun)
        .set({ artifactsPath: envArtifactsPath, updatedAt: new Date() })
        .where(eq(pipelineRun.id, run.id))
        .catch(() => undefined);
    }

    const artifactsBase = envArtifactsPath;
    const resultDocPath = `${artifactsBase}/result.json`;

    // Load persona soul — every stage must have a persona configured
    if (!stage.personaId) {
      throw new Error(
        `Stage '${stage.name}' has no personaId configured — every stage must have a persona assigned`
      );
    }
    const [personaRow] = await db
      .select({ soul: persona.soul })
      .from(persona)
      .where(eq(persona.id, stage.personaId));
    if (!personaRow) {
      throw new Error(`Persona not found: ${stage.personaId}`);
    }
    if (!personaRow.soul) {
      throw new Error(`Persona soul is empty for persona: ${stage.personaId}`);
    }
    const personaSoul = personaRow.soul;

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

    // Load issue and project context — fail fast on missing rows. Column
    // titles/names are NOT NULL at the schema layer; no presentation defaults.
    if (!run.issueId) {
      throw new Error(`Pipeline run ${run.id} has no issueId`);
    }
    const [issueRow] = await db
      .select({ title: issue.title, description: issue.bodyMd })
      .from(issue)
      .where(eq(issue.id, run.issueId));
    if (!issueRow) throw new Error(`Issue not found: ${run.issueId}`);

    const [projectRow] = await db
      .select({ name: project.name })
      .from(project)
      .where(eq(project.id, pipelineRow.projectId));
    if (!projectRow) {
      throw new Error(`Project not found: ${pipelineRow.projectId}`);
    }

    const { composePrompt } = await import('@/core/pipeline/prompt-composer');
    const composedPrompt = composePrompt(personaSoul, skills, {
      title: issueRow.title,
      description: issueRow.description,
      stageName: stage.name,
      projectName: projectRow.name,
      resultDocPath,
      artifactsDir: artifactsBase,
    });

    const transport = driverRow.promptTransport;
    const driverBinary = driverRow.binary;
    const rawDefaultArgs = driverRow.defaultArgs;
    if (
      !Array.isArray(rawDefaultArgs) ||
      !rawDefaultArgs.every((a) => typeof a === 'string')
    ) {
      throw new Error(
        `Driver '${driverRow.name}' defaultArgs must be a string array, got ${JSON.stringify(rawDefaultArgs)}`
      );
    }
    const driverArgs: string[] = [...(rawDefaultArgs as string[])];

    if (transport === 'argv') {
      driverArgs.push(composedPrompt);
    }

    await runService.updateStageRunStatus(sRun.id, STAGE_RUN_STATUS.running);

    if (!stageGraphRunner) {
      const msg = 'stageGraphRunner not injected — cannot execute stage';
      console.error(`[orchestrator] ${msg} (stageRunId: ${sRun.id})`);
      await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {
        errorMessage: msg,
      });
      await finishRun(run, PIPELINE_RUN_STATUS.failed);
      return;
    }

    let ingestOutput: string;
    let graphError: string | undefined;

    try {
      const result = await stageGraphRunner.run({
        stageRunId: sRun.id,
        resultDocPath,
        artifactsDir: artifactsBase,
        prompt: composedPrompt,
        driverCommand: driverBinary,
        driverArgs,
        cwd: envWorkingPath,
        env: {
          RESULT_DOC_PATH: resultDocPath,
          ARTIFACTS_DIR: artifactsBase,
          WORKING_PATH: envWorkingPath,
        },
        initResultDocScript:
          fluxaosConfig?.initResultDocScript ??
          '.next/daemon/init-result-doc.mjs',
        ingestResultDocScript:
          fluxaosConfig?.ingestResultDocScript ??
          '.next/daemon/ingest-result-doc.mjs',
      });
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

    // Parse ingest output to extract verdict, signal info, and execution metadata
    let verdict: string = GATE_VERDICT.proceed;
    let signalReason: string | null = null;
    let signalMeta: Record<string, unknown> | null = null;
    let tokensIn: number | undefined;
    let tokensOut: number | undefined;
    let modelIdentifier: string | undefined;

    let resultDoc: Record<string, unknown> | undefined;

    try {
      const parsed = IngestOutputSchema.parse(JSON.parse(ingestOutput));

      if (!parsed.valid && parsed.raw) {
        // Invalid doc — write raw for audit trail
        await db
          .update(stageRun)
          .set({ resultDoc: parsed.raw, updatedAt: new Date() })
          .where(eq(stageRun.id, sRun.id));
      }

      if (parsed.valid) {
        const doc = parsed.doc;
        if (doc.verdict === RESULT_DOC_VERDICT.pass)
          verdict = GATE_VERDICT.proceed;
        else if (doc.verdict === RESULT_DOC_VERDICT.fail)
          verdict = GATE_VERDICT.rework;
        else if (doc.verdict === RESULT_DOC_VERDICT.blocked)
          verdict = GATE_VERDICT.hold;
        signalReason = doc.signal_reason ?? null;
        signalMeta = doc.signal_meta ?? null;
        tokensIn = doc.meta?.input_tokens;
        tokensOut = doc.meta?.output_tokens;
        modelIdentifier = doc.meta?.model;
        resultDoc = doc as unknown as Record<string, unknown>;
      }
    } catch (err) {
      const errorMessage = `Ingest output failed validation — cannot safely determine verdict. Raw output: ${ingestOutput?.slice(0, 200)}. Error: ${err instanceof Error ? err.message : String(err)}`;
      await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.failed, {
        driver: driverBinary,
        trigger: TRIGGER_TYPE.automated,
        errorMessage,
      });
      await handleStageFailed(run, stage, sRun);
      return;
    }

    await runService.completeStageRun(sRun.id, STAGE_RUN_STATUS.completed, {
      driver: driverBinary,
      trigger: TRIGGER_TYPE.automated,
      tokensIn,
      tokensOut,
      model: modelIdentifier,
      resultDoc,
    });

    await applyVerdict(run, stage, sRun, verdict, signalReason, signalMeta);
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
      const reason = `Routing field for verdict '${verdict}' is null or empty on stage '${stage.name}'`;
      await finishRun(run, PIPELINE_RUN_STATUS.blocked);
      await blockIssueOnRun(db, run.issueId, {
        reason,
        appendPipelineFailed: true,
      });
      return;
    }

    if (targetStageName === PIPELINE_SENTINEL.complete) {
      await completePipelineRun(run);
      return;
    }

    if (targetStageName === PIPELINE_SENTINEL.blocked) {
      const question = signalMeta?.question as string | undefined;
      await blockIssueOnRun(db, run.issueId, {
        reason: signalReason ?? 'blocked',
        question,
      });
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
      const reason = `Routing target stage '${targetStageName}' not found in pipeline ${run.pipelineId} (verdict: ${verdict})`;
      await finishRun(run, PIPELINE_RUN_STATUS.blocked);
      await blockIssueOnRun(db, run.issueId, {
        reason,
        appendPipelineFailed: true,
      });
      return;
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
          ACTOR.orchestrator
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
        ACTOR.orchestrator
      );
    }
  }

  return { launchStage };
}
