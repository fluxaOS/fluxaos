import { z } from 'zod/v4';
import { router, publicProcedure } from '../trpc';
import { createSkillService } from '@/core/services';

const scope = z.enum(['global', 'project']);

export const skillRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return createSkillService(ctx.db).list();
  }),

  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createSkillService(ctx.db).listByProject(input.projectId);
    }),

  listGlobal: publicProcedure.query(({ ctx }) => {
    return createSkillService(ctx.db).listGlobal();
  }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createSkillService(ctx.db).getById(input.id);
    }),

  create: publicProcedure
    .input(z.object({
      scope,
      projectId: z.string().uuid().optional(),
      name: z.string().min(1),
      description: z.string().optional(),
      promptTemplate: z.string().optional(),
      inputSchema: z.unknown().optional(),
      outputSchema: z.unknown().optional(),
      tags: z.unknown().optional(),
    }))
    .mutation(({ ctx, input }) => {
      return createSkillService(ctx.db).create(input);
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      promptTemplate: z.string().optional(),
      inputSchema: z.unknown().optional(),
      outputSchema: z.unknown().optional(),
      tags: z.unknown().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return createSkillService(ctx.db).update(id, data);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      return createSkillService(ctx.db).remove(input.id);
    }),
});
