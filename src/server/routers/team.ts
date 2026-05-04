import { z } from 'zod/v4';
import { createTeamService } from '@/core/services';
import { inputId, publicProcedure, router } from '../trpc';

export const teamRouter = router({
  list: publicProcedure.query(({ ctx }) => createTeamService(ctx.db).list()),

  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      createTeamService(ctx.db).listByProject(input.projectId)
    ),

  getById: publicProcedure
    .input(inputId())
    .query(({ ctx, input }) => createTeamService(ctx.db).getById(input.id)),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1),
        description: z.string().optional(),
      })
    )
    .mutation(({ ctx, input }) => createTeamService(ctx.db).create(input)),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return createTeamService(ctx.db).update(id, data);
    }),

  delete: publicProcedure
    .input(inputId())
    .mutation(({ ctx, input }) => createTeamService(ctx.db).remove(input.id)),
});
