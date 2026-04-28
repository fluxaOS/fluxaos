import { and, eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { user } from '@/core/db/schema';
import { DELETE_ROLES, EDIT_ROLES, ROLE_VALUES } from '@/core/features/roles';
import { protectedMutation, publicProcedure, router } from '../trpc';

const roleEnum = z.enum(ROLE_VALUES as readonly [string, ...string[]]);

export const userRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(user).orderBy(user.name);
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
      return ctx.db
        .select()
        .from(user)
        .where(eq(user.orgId, input.orgId))
        .orderBy(user.name);
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(user)
        .where(eq(user.id, input.id));
      if (!row) throw new Error(`User not found: ${input.id}`);
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
      const [row] = await ctx.db.insert(user).values(input).returning();
      return row;
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
      const [row] = await ctx.db
        .update(user)
        .set({ ...data, version: version + 1, updatedAt: new Date() })
        .where(and(eq(user.id, id), eq(user.version, version)))
        .returning();
      if (!row) throw new Error('Optimistic concurrency conflict');
      return row;
    }),

  delete: protectedMutation(DELETE_ROLES)
    .input(z.object({ id: z.string().uuid(), version: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .delete(user)
        .where(and(eq(user.id, input.id), eq(user.version, input.version)))
        .returning();
      if (!row) {
        const [exists] = await ctx.db
          .select({ version: user.version })
          .from(user)
          .where(eq(user.id, input.id));
        if (!exists) throw new Error(`User not found: ${input.id}`);
        throw new Error('Optimistic concurrency conflict');
      }
      return row;
    }),
});
