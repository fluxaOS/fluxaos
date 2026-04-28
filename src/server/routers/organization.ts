import { z } from 'zod/v4';
import { DELETE_ROLES, EDIT_ROLES } from '@/core/features/roles';
import { TIER_VALUES } from '@/core/features/tiers';
import { createOrganizationService } from '@/core/services';
import { protectedMutation, publicProcedure, router } from '../trpc';

const tierEnum = z.enum(TIER_VALUES as readonly [string, ...string[]]);

export const organizationRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return createOrganizationService(ctx.db).list();
  }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createOrganizationService(ctx.db).getById(input.id);
    }),

  getBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(({ ctx, input }) => {
      return createOrganizationService(ctx.db).getBySlug(input.slug);
    }),

  create: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        name: z.string().min(1),
        slug: z.string().min(1),
        settings: z.record(z.string(), z.unknown()).optional(),
        // FLX-14: subscription tier defaults to 'free' at the DB layer if
        // the caller omits it — only operators should set it explicitly.
        subscriptionTier: tierEnum.optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      return createOrganizationService(ctx.db).create(input);
    }),

  update: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
        // FLX-14: tier change is gated by EDIT_ROLES (admin / maintainer).
        // In a real billing flow this would be set by the billing webhook
        // bypassing role gates; for the alpha homelab the operator does it.
        subscriptionTier: tierEnum.optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return createOrganizationService(ctx.db).update(id, data);
    }),

  delete: protectedMutation(DELETE_ROLES)
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      return createOrganizationService(ctx.db).remove(input.id);
    }),
});
