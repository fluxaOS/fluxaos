import { z } from 'zod/v4';
import { router, publicProcedure } from '../trpc';
import { createPipelineService } from '@/core/services';

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
});
