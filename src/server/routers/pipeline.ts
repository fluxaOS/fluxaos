import { z } from 'zod/v4';
import { eq } from 'drizzle-orm';
import { router, publicProcedure } from '../trpc';
import { createPipelineService } from '@/core/services';
import { createPipelineRunService } from '@/core/orchestrator/pipeline-run-service';
import { pipelineRun, stageRun, event } from '@/core/db/schema';

export const pipelineRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return createPipelineService(ctx.db).list();
  }),

  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createPipelineService(ctx.db).listByProject(input.projectId);
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createPipelineService(ctx.db).getById(input.id);
    }),

  create: publicProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      name: z.string().min(1),
      description: z.string().optional(),
      isDefault: z.boolean().optional(),
    }))
    .mutation(({ ctx, input }) => {
      return createPipelineService(ctx.db).create(input);
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      isDefault: z.boolean().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return createPipelineService(ctx.db).update(id, data);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      return createPipelineService(ctx.db).remove(input.id);
    }),

  // Stages
  stages: router({
    listByPipeline: publicProcedure
      .input(z.object({ pipelineId: z.string().uuid() }))
      .query(({ ctx, input }) => {
        return createPipelineService(ctx.db).stages.listByPipeline(input.pipelineId);
      }),

    create: publicProcedure
      .input(z.object({
        pipelineId: z.string().uuid(),
        name: z.string().min(1),
        sortOrder: z.number().int(),
        personaId: z.string().uuid().optional(),
        harness: z.string().optional(),
        timeoutSec: z.number().int().optional(),
        maxRetries: z.number().int().optional(),
        gateMode: z.string().optional(),
        gateRules: z.unknown().optional(),
      }))
      .mutation(({ ctx, input }) => {
        return createPipelineService(ctx.db).stages.create(input);
      }),

    update: publicProcedure
      .input(z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        sortOrder: z.number().int().optional(),
        personaId: z.string().uuid().optional(),
        harness: z.string().optional(),
        timeoutSec: z.number().int().optional(),
        maxRetries: z.number().int().optional(),
        gateMode: z.string().optional(),
        gateRules: z.unknown().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return createPipelineService(ctx.db).stages.update(id, data);
      }),

    delete: publicProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(({ ctx, input }) => {
        return createPipelineService(ctx.db).stages.remove(input.id);
      }),
  }),

  // ─── Pipeline Runs ──────────────────────────────────────────────────────
  runs: router({
    /** Trigger a new pipeline run for an issue. */
    trigger: publicProcedure
      .input(z.object({
        pipelineId: z.string().uuid(),
        issueId: z.string().uuid(),
      }))
      .mutation(({ ctx, input }) => {
        return createPipelineRunService(ctx.db).createRun(
          input.pipelineId,
          input.issueId,
        );
      }),

    /** Get a pipeline run by ID with its stage runs. */
    get: publicProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const svc = createPipelineRunService(ctx.db);
        const run = await svc.getRun(input.id);
        if (!run) return null;
        const stages = await svc.getStageRuns(input.id);
        return { ...run, stageRuns: stages };
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

    /** List pipeline runs for a project (via pipeline). */
    listByProject: publicProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { pipeline } = await import('@/core/db/schema');
        const pipelines = await ctx.db
          .select({ id: pipeline.id })
          .from(pipeline)
          .where(eq(pipeline.projectId, input.projectId));

        if (pipelines.length === 0) return [];

        const runs = [];
        for (const p of pipelines) {
          const pRuns = await ctx.db
            .select()
            .from(pipelineRun)
            .where(eq(pipelineRun.pipelineId, p.id));
          runs.push(...pRuns);
        }
        return runs.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      }),

    /** Cancel a pipeline run. */
    cancel: publicProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const svc = createPipelineRunService(ctx.db);
        // Cancel all non-terminal stage runs
        const stages = await svc.getStageRuns(input.id);
        for (const s of stages) {
          if (!['completed', 'failed', 'timed_out', 'cancelled'].includes(s.status)) {
            await svc.completeStageRun(s.id, 'cancelled', {});
          }
        }
        await svc.completeRun(input.id, 'cancelled');
        return { cancelled: true };
      }),

    /** Get events for a stage run. */
    events: publicProcedure
      .input(z.object({ stageRunId: z.string().uuid() }))
      .query(({ ctx, input }) => {
        return ctx.db
          .select()
          .from(event)
          .where(eq(event.stageRunId, input.stageRunId))
          .orderBy(event.timestamp);
      }),
  }),
});
