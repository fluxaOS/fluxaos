import { TRPCError } from '@trpc/server';
import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { pipelineRun, stageGateResult, stageRun } from '@/core/db/schema';
import { createPipelineRunService } from '@/core/orchestrator/pipeline-run-service';
import { createPipelineService } from '@/core/services';
import { createIssueService } from '@/core/services/issue';
import { inputId, publicProcedure, router } from '../trpc';
import { listIssueRunsWithStages } from './pipeline-run-history';

export const pipelineRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return createPipelineService(ctx.db).list();
  }),

  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createPipelineService(ctx.db).listByProject(input.projectId);
    }),

  getById: publicProcedure.input(inputId()).query(({ ctx, input }) => {
    return createPipelineService(ctx.db).getById(input.id);
  }),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1),
        description: z.string().optional(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      return createPipelineService(ctx.db).create(input);
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return createPipelineService(ctx.db).update(id, data);
    }),

  delete: publicProcedure.input(inputId()).mutation(({ ctx, input }) => {
    return createPipelineService(ctx.db).remove(input.id);
  }),

  // Stages
  stages: router({
    listByPipeline: publicProcedure
      .input(z.object({ pipelineId: z.string().uuid() }))
      .query(({ ctx, input }) => {
        return createPipelineService(ctx.db).stages.listByPipeline(
          input.pipelineId
        );
      }),

    create: publicProcedure
      .input(
        z.object({
          pipelineId: z.string().uuid(),
          name: z.string().min(1),
          sortOrder: z.number().int(),
          personaId: z.string().uuid().optional(),
          driver: z.string().optional(),
          driverId: z.string().uuid().optional(),
          timeoutSec: z.number().int().optional(),
          maxRetries: z.number().int().optional(),
          gateMode: z.string().optional(),
          gateRules: z.unknown().optional(),
          onPass: z.string().nullable().optional(),
          onFail: z.string().nullable().optional(),
          fallback: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        return createPipelineService(ctx.db).stages.create(input);
      }),

    update: publicProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().min(1).optional(),
          sortOrder: z.number().int().optional(),
          personaId: z.string().uuid().optional(),
          driver: z.string().optional(),
          driverId: z.string().uuid().nullable().optional(),
          timeoutSec: z.number().int().optional(),
          maxRetries: z.number().int().optional(),
          gateMode: z.string().optional(),
          gateRules: z.unknown().optional(),
          onPass: z.string().nullable().optional(),
          onFail: z.string().nullable().optional(),
          fallback: z.string().nullable().optional(),
        })
      )
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return createPipelineService(ctx.db).stages.update(id, data);
      }),

    delete: publicProcedure.input(inputId()).mutation(({ ctx, input }) => {
      return createPipelineService(ctx.db).stages.remove(input.id);
    }),
  }),

  // ─── Pipeline Runs ──────────────────────────────────────────────────────
  runs: router({
    /**
     * Trigger a manual pipeline run for a single stage.
     *
     * Publish-only: creates the pipeline_run at `pending` and a stage_run
     * at `pending` for the chosen stage. The orchestrator daemon
     * (R-DAEMON) picks up the Realtime INSERT, reuses the pending
     * stage_run, and drives the run to terminal. If the daemon is not
     * running, the pipeline_run sits at `pending` — that's the correct
     * signal the daemon is down.
     */
    trigger: publicProcedure
      .input(
        z.object({
          pipelineId: z.string().uuid(),
          issueId: z.string().uuid(),
          stageId: z.string().uuid(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // R-EPIC: parents-with-open-children are not work items. Reject at
        // the trigger boundary so we don't mint a pipeline_run row that
        // would have to be rolled back.
        const issueSvc = createIssueService(ctx.db);
        if (await issueSvc.hasOpenChildren(input.issueId)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'ISSUE_IS_EPIC',
          });
        }

        const svc = createPipelineRunService(ctx.db);
        const run = await svc.createRun(input.pipelineId, input.issueId);
        // Seed a pending stage_run so the daemon launches the user-chosen
        // stage, not the pipeline's stages[0]. Daemon's handleNewRun
        // reuses the pending row rather than creating a duplicate.
        const sr = await svc.createStageRun(run.id, input.stageId);
        await svc.appendEvent(sr.id, 'launched', {
          reason: 'manually triggered by user — awaiting daemon pickup',
        });

        return run;
      }),

    /** Get a pipeline run by ID with enriched stage runs (stage name, events). */
    get: publicProcedure.input(inputId()).query(async ({ ctx, input }) => {
      const { pipelineStage } = await import('@/core/db/schema');
      const svc = createPipelineRunService(ctx.db);
      const run = await svc.getRun(input.id);
      if (!run) return null;

      const rawStageRuns = await svc.getStageRuns(input.id);

      // Enrich each stage run with stage definition + events
      const enrichedStageRuns = await Promise.all(
        rawStageRuns.map(async (sr) => {
          const [stageDef] = await ctx.db
            .select()
            .from(pipelineStage)
            .where(eq(pipelineStage.id, sr.pipelineStageId));

          const events = await svc.listEvents(sr.id);

          return {
            ...sr,
            pipelineStage: stageDef
              ? {
                  name: stageDef.name,
                  sortOrder: stageDef.sortOrder,
                  gateMode: stageDef.gateMode,
                }
              : null,
            events,
          };
        })
      );

      return { ...run, stageRuns: enrichedStageRuns };
    }),

    /** List pipeline runs for a pipeline. */
    list: publicProcedure
      .input(z.object({ pipelineId: z.string().uuid() }))
      .query(({ ctx, input }) => {
        return ctx.db
          .select()
          .from(pipelineRun)
          .where(eq(pipelineRun.pipelineId, input.pipelineId))
          .orderBy(pipelineRun.createdAt);
      }),

    /** List pipeline runs for a project (via pipeline), with pipeline name. */
    listByProject: publicProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { pipeline } = await import('@/core/db/schema');
        const pipelines = await ctx.db
          .select({ id: pipeline.id, name: pipeline.name })
          .from(pipeline)
          .where(eq(pipeline.projectId, input.projectId));

        if (pipelines.length === 0) return [];

        const pipelineNames = new Map(pipelines.map((p) => [p.id, p.name]));
        const runs = [];
        for (const p of pipelines) {
          const pRuns = await ctx.db
            .select()
            .from(pipelineRun)
            .where(eq(pipelineRun.pipelineId, p.id));
          runs.push(
            ...pRuns.map((r) => ({
              ...r,
              pipelineName: pipelineNames.get(r.pipelineId) ?? '',
            }))
          );
        }
        return runs.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      }),

    /** List pipeline runs for an issue, newest first, with stage summaries. */
    listByIssue: publicProcedure
      .input(z.object({ issueId: z.string().uuid() }))
      .query(({ ctx, input }) =>
        listIssueRunsWithStages(ctx.db, input.issueId)
      ),

    /** Cancel a pipeline run. */
    cancel: publicProcedure
      .input(inputId())
      .mutation(async ({ ctx, input }) => {
        const svc = createPipelineRunService(ctx.db);
        // Cancel all non-terminal stage runs
        const stages = await svc.getStageRuns(input.id);
        for (const s of stages) {
          if (
            !['completed', 'failed', 'timed_out', 'cancelled'].includes(
              s.status
            )
          ) {
            terminateStageProcess(s.pid);
            await svc.completeStageRun(s.id, 'cancelled', {});
            await svc.appendEvent(s.id, 'cancelled', {
              reason: 'cancelled by user',
            });
          }
        }
        await svc.completeRun(input.id, 'cancelled');
        return { cancelled: true };
      }),

    /** Cancel a specific stage run. */
    cancelStage: publicProcedure
      .input(z.object({ stageRunId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const svc = createPipelineRunService(ctx.db);
        const [row] = await ctx.db
          .select({
            id: stageRun.id,
            pipelineRunId: stageRun.pipelineRunId,
            pid: stageRun.pid,
          })
          .from(stageRun)
          .where(eq(stageRun.id, input.stageRunId));
        if (!row) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Stage run not found',
          });
        }
        terminateStageProcess(row.pid);
        await svc.completeStageRun(row.id, 'cancelled', {});
        await svc.appendEvent(input.stageRunId, 'cancelled', {
          reason: 'cancelled by user',
        });
        await svc.completeRun(row.pipelineRunId, 'cancelled');
        return { cancelled: true };
      }),

    /** Get events for a stage run. */
    events: publicProcedure
      .input(z.object({ stageRunId: z.string().uuid() }))
      .query(({ ctx, input }) => {
        return createPipelineRunService(ctx.db).listEvents(input.stageRunId);
      }),

    /** Approve a held stage — release it for execution. */
    approveStage: publicProcedure
      .input(z.object({ stageRunId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const svc = createPipelineRunService(ctx.db);
        // Mark the pending stage as launching so the orchestrator picks it up
        await svc.updateStageRunStatus(input.stageRunId, 'launching');
        await svc.appendEvent(input.stageRunId, 'gate_checked', {
          verdict: 'proceed',
          reason: 'manually approved',
        });
        return { approved: true };
      }),

    /** Reject a held stage — rework or abort. */
    rejectStage: publicProcedure
      .input(
        z.object({
          stageRunId: z.string().uuid(),
          verdict: z.enum(['rework', 'abort']),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const svc = createPipelineRunService(ctx.db);
        const status = input.verdict === 'abort' ? 'cancelled' : 'failed';
        await svc.completeStageRun(input.stageRunId, status, {});
        await svc.appendEvent(
          input.stageRunId,
          input.verdict === 'abort' ? 'cancelled' : 'failed',
          {
            reason: `manually rejected: ${input.verdict}`,
          }
        );
        return { rejected: true, verdict: input.verdict };
      }),

    /** Get the current pipeline state for an issue — latest run + current stage. */
    issueState: publicProcedure
      .input(z.object({ issueId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { pipelineStage } = await import('@/core/db/schema');

        // Find latest pipeline run for this issue
        const [latestRun] = await ctx.db
          .select()
          .from(pipelineRun)
          .where(eq(pipelineRun.issueId, input.issueId))
          .orderBy(desc(pipelineRun.createdAt))
          .limit(1);

        if (!latestRun) return null;

        // Get all stage runs for this pipeline run
        const stageRuns = await ctx.db
          .select()
          .from(stageRun)
          .where(eq(stageRun.pipelineRunId, latestRun.id))
          .orderBy(asc(stageRun.createdAt));

        // Get all stages for the pipeline (for display)
        const stages = await ctx.db
          .select()
          .from(pipelineStage)
          .where(eq(pipelineStage.pipelineId, latestRun.pipelineId))
          .orderBy(asc(pipelineStage.sortOrder));

        // Find current stage — last non-terminal stage run, or the last completed one
        const currentStageRun =
          stageRuns.length > 0 ? stageRuns[stageRuns.length - 1] : null;

        const currentStage = currentStageRun
          ? (stages.find((s) => s.id === currentStageRun.pipelineStageId) ??
            null)
          : null;

        return {
          run: latestRun,
          stages: stages.map((s) => ({
            ...s,
            stageRun:
              stageRuns.find((sr) => sr.pipelineStageId === s.id) ?? null,
          })),
          currentStage,
          currentStageRun,
        };
      }),

    /** Execute a specific stage run — mark it as launching for the orchestrator. */
    executeStage: publicProcedure
      .input(z.object({ stageRunId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const svc = createPipelineRunService(ctx.db);
        await svc.updateStageRunStatus(input.stageRunId, 'launching');
        await svc.appendEvent(input.stageRunId, 'launched', {
          reason: 'manually executed by user',
        });
        return { executed: true };
      }),

    /** Get gate results for a stage run. */
    gateResults: publicProcedure
      .input(z.object({ stageRunId: z.string().uuid() }))
      .query(({ ctx, input }) => {
        return ctx.db
          .select()
          .from(stageGateResult)
          .where(eq(stageGateResult.stageRunId, input.stageRunId))
          .orderBy(stageGateResult.createdAt);
      }),

    /** KPIs — aggregate stats for a project's pipeline runs. */
    kpis: publicProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { pipeline } = await import('@/core/db/schema');
        const pipelines = await ctx.db
          .select({ id: pipeline.id })
          .from(pipeline)
          .where(eq(pipeline.projectId, input.projectId));

        if (pipelines.length === 0) {
          return {
            totalRuns: 0,
            completedRuns: 0,
            failedRuns: 0,
            cancelledRuns: 0,
            runningRuns: 0,
            successRate: 0,
            totalCostUsd: '0',
            avgCostUsd: '0',
          };
        }

        const allRuns = [];
        for (const p of pipelines) {
          const runs = await ctx.db
            .select()
            .from(pipelineRun)
            .where(eq(pipelineRun.pipelineId, p.id));
          allRuns.push(...runs);
        }

        const total = allRuns.length;
        const completed = allRuns.filter(
          (r) => r.status === 'completed'
        ).length;
        const failed = allRuns.filter((r) => r.status === 'failed').length;
        const cancelled = allRuns.filter(
          (r) => r.status === 'cancelled'
        ).length;
        const running = allRuns.filter((r) => r.status === 'running').length;
        const totalCost = allRuns.reduce(
          (s, r) => s + Number(r.totalCostUsd ?? 0),
          0
        );

        return {
          totalRuns: total,
          completedRuns: completed,
          failedRuns: failed,
          cancelledRuns: cancelled,
          runningRuns: running,
          successRate: total > 0 ? Math.round((completed / total) * 100) : 0,
          totalCostUsd: totalCost.toFixed(4),
          avgCostUsd: total > 0 ? (totalCost / total).toFixed(4) : '0',
        };
      }),
  }),
});

function terminateStageProcess(pid: number | null): void {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: string }).code === 'ESRCH'
    ) {
      return;
    }
    throw err;
  }
}
