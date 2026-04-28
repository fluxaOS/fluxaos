import { and, eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { user } from '@/core/db/schema';
import { publicProcedure, router } from '../trpc';

export const userRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(user).orderBy(user.name);
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

  create: publicProcedure
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db.insert(user).values(input).returning();
      return row;
    }),

  update: publicProcedure
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

  delete: publicProcedure
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
