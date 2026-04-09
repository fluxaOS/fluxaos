import { z } from 'zod/v4';
import { router, publicProcedure } from '../trpc';
import { createProjectService } from '@/core/services';

export const projectRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return createProjectService(ctx.db).list();
  }),

  listByOrg: publicProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createProjectService(ctx.db).listByOrg(input.orgId);
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createProjectService(ctx.db).getById(input.id);
    }),

  create: publicProcedure
    .input(z.object({
      orgId: z.string().uuid(),
      name: z.string().min(1),
      slug: z.string().min(1),
      repoUrl: z.string().optional(),
    }))
    .mutation(({ ctx, input }) => {
      return createProjectService(ctx.db).create(input);
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      slug: z.string().min(1).optional(),
      repoUrl: z.string().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return createProjectService(ctx.db).update(id, data);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      return createProjectService(ctx.db).remove(input.id);
    }),
});
