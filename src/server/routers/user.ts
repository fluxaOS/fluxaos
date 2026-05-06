import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import { DELETE_ROLES, EDIT_ROLES, ROLE_VALUES } from '@/core/features/roles';
import { NotFoundError } from '@/core/errors/domain';
import { createUserService } from '@/core/services/user';
import { inputId, protectedMutation, publicProcedure, router } from '../trpc';

const roleEnum = z.enum(ROLE_VALUES as readonly [string, ...string[]]);

export const userRouter = router({
  /**
   * List users scoped to the given org.
   * Replaces the banned unscoped `list()` from the user service.
   */
  list: publicProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return createUserService(ctx.db).listByOrg(input.orgId);
    }),

  // FLX-12: client-side gates need to know the viewer's effective role.
  // Returns the role resolved by tRPC context (Supabase session ↦ user.role,
  // or 'admin' under the homelab LAN bypass).
  viewerRole: publicProcedure.query(({ ctx }) => {
    return { role: ctx.viewer.role };
  }),

  // FLX-14: client-side feature gates need to know the viewer's effective
  // subscription tier. Returns the tier resolved by tRPC context
  // (organization.subscription_tier, or 'enterprise' under the homelab
  // LAN bypass).
  viewerTier: publicProcedure.query(({ ctx }) => {
    return { tier: ctx.viewer.tier };
  }),

  listByOrg: publicProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return createUserService(ctx.db).listByOrg(input.orgId);
    }),

  getById: publicProcedure.input(inputId()).query(async ({ ctx, input }) => {
    const row = await createUserService(ctx.db).getById(input.id);
    if (!row)
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `User not found: ${input.id}`,
      });
    return row;
  }),

  create: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        orgId: z.string().uuid(),
        name: z.string().min(1),
        email: z.string().email(),
        slug: z
          .string()
          .min(1)
          .regex(
            /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
            'slug must be kebab-case (lowercase, digits, dashes only)'
          ),
        avatarUrl: z.string().url().nullable().optional(),
        role: roleEnum.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createUserService(ctx.db).create(input as any);
    }),

  update: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        slug: z
          .string()
          .min(1)
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case')
          .optional(),
        avatarUrl: z.string().url().nullable().optional(),
        role: roleEnum.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      return createUserService(ctx.db).updateWithVersion(
        id,
        version,
        data as any
      );
    }),

  delete: protectedMutation(DELETE_ROLES)
    .input(z.object({ id: z.string().uuid(), version: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await createUserService(ctx.db).deleteWithVersion(
          input.id,
          input.version
        );
      } catch (err) {
        if (err instanceof NotFoundError) {
          throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
        }
        throw err;
      }
    }),
});
