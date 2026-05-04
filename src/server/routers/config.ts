import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import { createConfigService } from '@/core/services/config';
import { inputId, publicProcedure, router } from '../trpc';

export const configRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return createConfigService(ctx.db).list();
  }),

  getById: publicProcedure.input(inputId()).query(async ({ ctx, input }) => {
    const row = await createConfigService(ctx.db).getById(input.id);
    if (!row)
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Config entry not found: ${input.id}`,
      });
    return row;
  }),

  create: publicProcedure
    .input(
      z.object({
        scope: z.string().min(1).default('global'),
        projectId: z.string().uuid().nullable().optional(),
        key: z.string().min(1),
        value: z.unknown(),
        changedBy: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createConfigService(ctx.db).create({
        scope: input.scope,
        projectId: input.projectId ?? null,
        key: input.key,
        value: input.value,
        changedBy: input.changedBy ?? null,
      });
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        scope: z.string().min(1).optional(),
        key: z.string().min(1).optional(),
        value: z.unknown().optional(),
        changedBy: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      return createConfigService(ctx.db).update(id, version, data);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid(), version: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return createConfigService(ctx.db).delete(input.id, input.version);
    }),
});
