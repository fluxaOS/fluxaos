import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import { createTeamService } from '@/core/services';
import { publicProcedure, router } from '../trpc';

export const teamRouter = router({
  list: publicProcedure.query(({ ctx }) => createTeamService(ctx.db).list()),

  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      createTeamService(ctx.db).listByProject(input.projectId)
    ),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
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
        version: z.number().int(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      const row = await createTeamService(ctx.db).updateWithVersion(
        id,
        version,
        data
      );
      if (!row)
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Optimistic concurrency conflict',
        });
      return row;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid(), version: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await createTeamService(ctx.db).deleteWithVersion(
        input.id,
        input.version
      );
      if (!ok)
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'Optimistic concurrency conflict — team was modified elsewhere.',
        });
      return { id: input.id };
    }),
});
