import { z } from 'zod';
import {
  createRoutingProfile,
  createRoutingRule,
  deleteRoutingProfile,
  deleteRoutingRule,
  getRoutingProfile,
  listRoutingProfiles,
  listRoutingRules,
  updateRoutingProfile,
  updateRoutingRule,
} from '@/core/routing';
import { publicProcedure, router } from '@/server/trpc';

export const routingRouter = router({
  createProfile: publicProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        name: z.string().min(1),
        description: z.string().optional(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(({ input }) => createRoutingProfile(input)),

  listProfiles: publicProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(({ input }) => listRoutingProfiles(input.orgId)),

  getProfile: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getRoutingProfile(input.id)),

  updateProfile: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        isDefault: z.boolean().optional(),
      })
    )
    .mutation(({ input }) => {
      const { id, ...updates } = input;
      return updateRoutingProfile(id, updates);
    }),

  deleteProfile: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => deleteRoutingProfile(input.id)),

  // Rule sub-routes
  createRule: publicProcedure
    .input(
      z.object({
        profileId: z.string().uuid(),
        stageName: z.string().optional(),
        allowedModelsPattern: z.string().optional(),
        preferredHarness: z.string().optional(),
        fallbackHarness: z.string().optional(),
        sortStrategy: z.string().optional(),
        maxCostUsd: z.string().optional(),
      })
    )
    .mutation(({ input }) => createRoutingRule(input)),

  listRules: publicProcedure
    .input(z.object({ profileId: z.string().uuid() }))
    .query(({ input }) => listRoutingRules(input.profileId)),

  updateRule: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        stageName: z.string().optional(),
        allowedModelsPattern: z.string().optional(),
        preferredHarness: z.string().optional(),
        fallbackHarness: z.string().optional(),
        sortStrategy: z.string().optional(),
        maxCostUsd: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const { id, ...updates } = input;
      return updateRoutingRule(id, updates);
    }),

  deleteRule: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => deleteRoutingRule(input.id)),
});
