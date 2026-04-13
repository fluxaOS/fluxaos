import { z } from 'zod/v4';
import { eq, and } from 'drizzle-orm';
import { router, publicProcedure } from '../trpc';
import { harnessCatalog } from '@/core/db/schema';

export const harnessRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(harnessCatalog).orderBy(harnessCatalog.name);
  }),

  getBySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(harnessCatalog)
        .where(eq(harnessCatalog.slug, input.slug));
      if (!row) throw new Error(`Harness not found: ${input.slug}`);
      return row;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(harnessCatalog)
        .where(eq(harnessCatalog.id, input.id));
      if (!row) throw new Error(`Harness not found: ${input.id}`);
      return row;
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        slug: z.string().min(1),
        binary: z.string().min(1),
        defaultArgs: z.array(z.string()).optional(),
        modelFlag: z.string().optional(),
        dirFlag: z.string().optional(),
        sessionNameFlag: z.string().optional(),
        promptTransport: z.string().optional(),
        promptSendDelayMs: z.number().int().optional(),
        probeCommand: z.string().optional(),
        issuePromptTemplate: z.string().optional(),
        queuePromptTemplate: z.string().optional(),
        envVars: z.record(z.string(), z.string()).optional(),
        extraArgs: z.record(z.string(), z.unknown()).optional(),
        isEnabled: z.boolean().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(harnessCatalog)
        .values(input)
        .returning();
      return row;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        name: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        binary: z.string().min(1).optional(),
        defaultArgs: z.array(z.string()).optional(),
        modelFlag: z.string().nullable().optional(),
        dirFlag: z.string().nullable().optional(),
        sessionNameFlag: z.string().nullable().optional(),
        promptTransport: z.string().optional(),
        promptSendDelayMs: z.number().int().optional(),
        probeCommand: z.string().nullable().optional(),
        issuePromptTemplate: z.string().nullable().optional(),
        queuePromptTemplate: z.string().nullable().optional(),
        envVars: z.record(z.string(), z.string()).optional(),
        extraArgs: z.record(z.string(), z.unknown()).optional(),
        isEnabled: z.boolean().optional(),
        notes: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      const [row] = await ctx.db
        .update(harnessCatalog)
        .set({ ...data, version: version + 1, updatedAt: new Date() })
        .where(
          and(eq(harnessCatalog.id, id), eq(harnessCatalog.version, version)),
        )
        .returning();
      if (!row) throw new Error('Optimistic concurrency conflict');
      return row;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .delete(harnessCatalog)
        .where(eq(harnessCatalog.id, input.id))
        .returning();
      if (!row) throw new Error(`Harness not found: ${input.id}`);
      return row;
    }),
});
