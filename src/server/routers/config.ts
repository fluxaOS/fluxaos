import { and, eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { configEntry } from '@/core/db/schema';
import { publicProcedure, router } from '../trpc';

export const configRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(configEntry).orderBy(configEntry.key);
  }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(configEntry)
        .where(eq(configEntry.id, input.id));
      if (!row) throw new Error(`Config entry not found: ${input.id}`);
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
      const [row] = await ctx.db
        .insert(configEntry)
        .values({
          scope: input.scope,
          projectId: input.projectId ?? null,
          key: input.key,
          value: input.value as never,
          changedBy: input.changedBy ?? null,
        })
        .returning();
      return row;
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
      const { id, version, value, ...rest } = input;
      // Fetch the current row to snapshot previousValue when value changes.
      const [current] = await ctx.db
        .select()
        .from(configEntry)
        .where(eq(configEntry.id, id));
      if (!current) throw new Error(`Config entry not found: ${id}`);

      const patch: Record<string, unknown> = {
        ...rest,
        version: version + 1,
        updatedAt: new Date(),
      };
      if (value !== undefined) {
        patch.value = value;
        patch.previousValue = current.value;
      }
      const [row] = await ctx.db
        .update(configEntry)
        .set(patch as never)
        .where(and(eq(configEntry.id, id), eq(configEntry.version, version)))
        .returning();
      if (!row) throw new Error('Optimistic concurrency conflict');
      return row;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid(), version: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .delete(configEntry)
        .where(
          and(
            eq(configEntry.id, input.id),
            eq(configEntry.version, input.version)
          )
        )
        .returning();
      if (!row) {
        const [exists] = await ctx.db
          .select({ version: configEntry.version })
          .from(configEntry)
          .where(eq(configEntry.id, input.id));
        if (!exists) throw new Error(`Config entry not found: ${input.id}`);
        throw new Error('Optimistic concurrency conflict');
      }
      return row;
    }),
});
