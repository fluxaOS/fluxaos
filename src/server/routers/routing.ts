import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import { createRoutingService } from '@/core/services';
import { publicProcedure, router } from '../trpc';

export const routingRouter = router({
  listProfiles: publicProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      createRoutingService(ctx.db).listByOrg(input.orgId)
    ),

  getProfile: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => createRoutingService(ctx.db).getById(input.id)),

  createProfile: publicProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        name: z.string().min(1),
        description: z.string().optional(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input }) => createRoutingService(ctx.db).create(input)),

  updateProfile: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...patch } = input;
      const row = await createRoutingService(ctx.db).updateWithVersion(
        id,
        version,
        patch
      );
      if (!row)
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Optimistic concurrency conflict',
        });
      return row;
    }),

  deleteProfile: publicProcedure
    .input(z.object({ id: z.string().uuid(), version: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.db.transaction(async (tx) => {
        const svc = createRoutingService(tx);

        // FK guard: reject if any persona still references this profile
        const refs = await svc.countReferences(input.id);
        if (refs.personas > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Cannot delete routing profile — referenced by ${refs.personas} persona(s). Remove references first.`,
          });
        }

        const ok = await svc.deleteWithVersion(input.id, input.version);
        if (!ok) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'Optimistic concurrency conflict — routing profile was modified elsewhere.',
          });
        }
        return { id: input.id };
      });
    }),

  // Rules
  listRules: publicProcedure
    .input(z.object({ profileId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      createRoutingService(ctx.db).rules.listByProfile(input.profileId)
    ),

  createRule: publicProcedure
    .input(
      z.object({
        profileId: z.string().uuid(),
        stageName: z.string().optional(),
        allowedModelsPattern: z
          .string()
          .max(500, 'Pattern must be 500 characters or fewer')
          .refine(
            (p) => {
              try {
                new RegExp(p);
                return true;
              } catch {
                return false;
              }
            },
            { message: 'Invalid regular expression syntax' }
          )
          .optional(),
        preferredDriver: z.string().optional(),
        sortStrategy: z.string().optional(),
        maxCostUsd: z.string().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      createRoutingService(ctx.db).rules.create(input)
    ),

  deleteRule: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      createRoutingService(ctx.db).rules.remove(input.id)
    ),
});
