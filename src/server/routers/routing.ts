import { z } from 'zod/v4';
import { createRoutingService } from '@/core/services';
import { inputId, publicProcedure, router } from '../trpc';

export const routingRouter = router({
  listProfiles: publicProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      createRoutingService(ctx.db).listByOrg(input.orgId)
    ),

  getProfile: publicProcedure
    .input(inputId())
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
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { id, ...patch } = input;
      return createRoutingService(ctx.db).update(id, patch);
    }),

  deleteProfile: publicProcedure
    .input(inputId())
    .mutation(({ ctx, input }) =>
      createRoutingService(ctx.db).remove(input.id)
    ),

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
        allowedModelsPattern: z.string().optional(),
        preferredDriver: z.string().optional(),
        fallbackDriver: z.string().optional(),
        sortStrategy: z.string().optional(),
        maxCostUsd: z.string().optional(),
      })
    )
    .mutation(({ ctx, input }) =>
      createRoutingService(ctx.db).rules.create(input)
    ),

  deleteRule: publicProcedure
    .input(inputId())
    .mutation(({ ctx, input }) =>
      createRoutingService(ctx.db).rules.remove(input.id)
    ),
});
