import { z } from 'zod/v4';
import { router, publicProcedure } from '../trpc';
import { createRoutingService } from '@/core/services';

export const routingRouter = router({
  listProfiles: publicProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      createRoutingService(ctx.db).listByOrg(input.orgId)),

  getProfile: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) =>
      createRoutingService(ctx.db).getById(input.id)),

  createProfile: publicProcedure
    .input(z.object({
      orgId: z.string().uuid(),
      name: z.string().min(1),
      description: z.string().optional(),
      isDefault: z.boolean().optional(),
    }))
    .mutation(({ ctx, input }) =>
      createRoutingService(ctx.db).create(input)),

  deleteProfile: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      createRoutingService(ctx.db).remove(input.id)),

  // Rules
  listRules: publicProcedure
    .input(z.object({ profileId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      createRoutingService(ctx.db).rules.listByProfile(input.profileId)),

  createRule: publicProcedure
    .input(z.object({
      profileId: z.string().uuid(),
      stageName: z.string().optional(),
      allowedModelsPattern: z.string().optional(),
      preferredHarness: z.string().optional(),
      fallbackHarness: z.string().optional(),
      sortStrategy: z.string().optional(),
      maxCostUsd: z.string().optional(),
    }))
    .mutation(({ ctx, input }) =>
      createRoutingService(ctx.db).rules.create(input)),

  deleteRule: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      createRoutingService(ctx.db).rules.remove(input.id)),
});
