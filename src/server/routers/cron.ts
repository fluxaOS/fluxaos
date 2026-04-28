import { and, eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { cronJob } from '@/core/db/schema';
import { publicProcedure, router } from '../trpc';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Liberal cron expression check — five or six space-separated fields.
// We don't validate field semantics here; that's the runtime's concern.
const CRON_RE = /^(\S+\s+){4,5}\S+$/;

export const cronRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(cronJob).orderBy(cronJob.name);
  }),

  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(cronJob)
        .where(eq(cronJob.projectId, input.projectId))
        .orderBy(cronJob.name);
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(cronJob)
        .where(eq(cronJob.id, input.id));
      if (!row) throw new Error(`Cron job not found: ${input.id}`);
      return row;
    }),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1),
        slug: z.string().regex(SLUG_RE, 'slug must be kebab-case'),
        cronExpression: z
          .string()
          .regex(
            CRON_RE,
            'cron expression must be 5 or 6 space-separated fields'
          ),
        actionType: z.string().min(1),
        actionPayload: z.unknown().optional(),
        isEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(cronJob)
        .values({
          projectId: input.projectId,
          name: input.name,
          slug: input.slug,
          cronExpression: input.cronExpression,
          actionType: input.actionType,
          actionPayload: (input.actionPayload ?? null) as never,
          isEnabled: input.isEnabled ?? true,
        })
        .returning();
      return row;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        name: z.string().min(1).optional(),
        slug: z.string().regex(SLUG_RE).optional(),
        cronExpression: z.string().regex(CRON_RE).optional(),
        actionType: z.string().min(1).optional(),
        actionPayload: z.unknown().optional(),
        isEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      const [row] = await ctx.db
        .update(cronJob)
        .set({
          ...(data as Record<string, unknown>),
          version: version + 1,
          updatedAt: new Date(),
        } as never)
        .where(and(eq(cronJob.id, id), eq(cronJob.version, version)))
        .returning();
      if (!row) throw new Error('Optimistic concurrency conflict');
      return row;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid(), version: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .delete(cronJob)
        .where(
          and(eq(cronJob.id, input.id), eq(cronJob.version, input.version))
        )
        .returning();
      if (!row) {
        const [exists] = await ctx.db
          .select({ version: cronJob.version })
          .from(cronJob)
          .where(eq(cronJob.id, input.id));
        if (!exists) throw new Error(`Cron job not found: ${input.id}`);
        throw new Error('Optimistic concurrency conflict');
      }
      return row;
    }),
});
