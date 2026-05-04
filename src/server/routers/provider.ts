import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import { createProviderService } from '@/core/services';
import { publicProcedure, router } from '../trpc';

export const providerRouter = router({
  list: publicProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      createProviderService(ctx.db).listByOrg(input.orgId)
    ),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => createProviderService(ctx.db).getById(input.id)),

  create: publicProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        name: z.string().min(1),
        type: z.string().min(1),
        baseUrl: z.string().optional(),
        apiKeyRef: z.string().optional(),
      })
    )
    .mutation(({ ctx, input }) => createProviderService(ctx.db).create(input)),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        name: z.string().min(1).optional(),
        type: z.string().min(1).optional(),
        baseUrl: z.string().optional(),
        apiKeyRef: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      const row = await createProviderService(ctx.db).updateWithVersion(
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
      return ctx.db.transaction(async (tx) => {
        const svc = createProviderService(tx);
        const refs = await svc.countReferences(input.id);
        if (refs.models > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Cannot delete provider — referenced by ${refs.models} model(s). Remove models first.`,
          });
        }
        const ok = await svc.deleteWithVersion(input.id, input.version);
        if (!ok) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'Optimistic concurrency conflict — provider was modified elsewhere.',
          });
        }
        return { id: input.id };
      });
    }),

  // Models
  listModels: publicProcedure
    .input(z.object({ providerId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      createProviderService(ctx.db).models.listByProvider(input.providerId)
    ),

  createModel: publicProcedure
    .input(
      z.object({
        providerId: z.string().uuid(),
        name: z.string().min(1),
        identifier: z.string().min(1),
        costPer1kInput: z.string().optional(),
        costPer1kOutput: z.string().optional(),
        capabilities: z.unknown().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      createProviderService(ctx.db).models.create(input)
    ),

  deleteModel: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      createProviderService(ctx.db).models.remove(input.id)
    ),
});
