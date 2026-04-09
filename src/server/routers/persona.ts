import { z } from 'zod/v4';
import { router, publicProcedure } from '../trpc';
import { createPersonaService } from '@/core/services';

export const personaRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return createPersonaService(ctx.db).list();
  }),

  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createPersonaService(ctx.db).listByProject(input.projectId);
    }),

  listGlobal: publicProcedure.query(({ ctx }) => {
    return createPersonaService(ctx.db).listGlobal();
  }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createPersonaService(ctx.db).getById(input.id);
    }),

  create: publicProcedure
    .input(z.object({
      scope: z.enum(['global', 'project']),
      projectId: z.string().uuid().optional(),
      name: z.string().min(1),
      soul: z.string().optional(),
      identity: z.unknown().optional(),
      brandId: z.string().uuid().optional(),
      routingProfileId: z.string().uuid().optional(),
      parentPersonaId: z.string().uuid().optional(),
    }))
    .mutation(({ ctx, input }) => {
      return createPersonaService(ctx.db).create(input);
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      soul: z.string().optional(),
      identity: z.unknown().optional(),
      brandId: z.string().uuid().optional(),
      routingProfileId: z.string().uuid().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return createPersonaService(ctx.db).update(id, data);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      return createPersonaService(ctx.db).remove(input.id);
    }),
});
