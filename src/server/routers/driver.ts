import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import { driver, pipelineStage, stageRun } from '@/core/db/schema';
import { publicProcedure, router } from '../trpc';

export const driverRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(driver).orderBy(driver.name);
  }),

  getBySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(driver)
        .where(eq(driver.slug, input.slug));
      if (!row) throw new Error(`Driver not found: ${input.slug}`);
      return row;
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(driver)
        .where(eq(driver.id, input.id));
      if (!row) throw new Error(`Driver not found: ${input.id}`);
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
        outputFormat: z.string().optional(),
        outputFormatFlag: z.string().optional(),
        promptSendDelayMs: z.number().int().optional(),
        probeCommand: z.string().optional(),
        issuePromptTemplate: z.string().optional(),
        queuePromptTemplate: z.string().optional(),
        envVars: z.record(z.string(), z.string()).optional(),
        extraArgs: z.record(z.string(), z.unknown()).optional(),
        contextLayout: z.unknown().optional(),
        isEnabled: z.boolean().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(driver)
        .values(input as any)
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
        outputFormat: z.string().optional(),
        outputFormatFlag: z.string().nullable().optional(),
        promptSendDelayMs: z.number().int().optional(),
        probeCommand: z.string().nullable().optional(),
        issuePromptTemplate: z.string().nullable().optional(),
        queuePromptTemplate: z.string().nullable().optional(),
        envVars: z.record(z.string(), z.string()).optional(),
        extraArgs: z.record(z.string(), z.unknown()).optional(),
        contextLayout: z.unknown().optional(),
        isEnabled: z.boolean().optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      const [row] = await ctx.db
        .update(driver)
        .set({ ...(data as any), version: version + 1, updatedAt: new Date() })
        .where(and(eq(driver.id, id), eq(driver.version, version)))
        .returning();
      if (!row) throw new Error('Optimistic concurrency conflict');
      return row;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid(), version: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      // Wrap FK count + version-locked delete in a single transaction so a
      // concurrent insert into pipelineStage / stageRun between the count
      // and the delete cannot orphan a reference. Without the transaction,
      // a concurrent writer could add a reference between the count (0)
      // and the delete (succeeds), then the DB's FK RESTRICT fires as an
      // unhandled tRPC 500 instead of the friendly "referenced by N" path.
      // Mirrors the FLX-63-equivalent skill.delete shape.
      return await ctx.db.transaction(async (tx) => {
        // 1. FK guard
        const [{ pipelineStages, stageRuns }] = await tx
          .select({
            pipelineStages: sql<number>`count(distinct ${pipelineStage.id})`,
            stageRuns: sql<number>`count(distinct ${stageRun.id})`,
          })
          .from(driver)
          .leftJoin(pipelineStage, eq(pipelineStage.driverId, driver.id))
          .leftJoin(stageRun, eq(stageRun.driverId, driver.id))
          .where(eq(driver.id, input.id));

        const pStages = Number(pipelineStages);
        const sRuns = Number(stageRuns);
        if (pStages + sRuns > 0) {
          throw new Error(
            `Cannot delete driver — referenced by ${pStages} pipeline stage(s) and ${sRuns} stage run(s). Remove references first.`
          );
        }

        // 2. Version-locked delete
        const [row] = await tx
          .delete(driver)
          .where(
            and(eq(driver.id, input.id), eq(driver.version, input.version))
          )
          .returning();
        if (!row) {
          // Either id missing or version mismatch — try to distinguish.
          const [exists] = await tx
            .select({ version: driver.version })
            .from(driver)
            .where(eq(driver.id, input.id));
          if (!exists) throw new Error(`Driver not found: ${input.id}`);
          throw new Error('Optimistic concurrency conflict');
        }
        return row;
      });
    }),
});
