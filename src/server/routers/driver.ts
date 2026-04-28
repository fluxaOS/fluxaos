import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import type { Database } from '@/core/db/connection';
import {
  driver,
  driverRevision,
  pipelineStage,
  stageRun,
} from '@/core/db/schema';
import { DELETE_ROLES, EDIT_ROLES, REVERT_ROLES } from '@/core/features/roles';
import { protectedMutation, publicProcedure, router } from '../trpc';

type DbOrTx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;
type DriverSelect = typeof driver.$inferSelect;

// FLX-91: append a driver_revision row capturing the post-update state.
// Computes the next revision_number atomically via a (SELECT max+1 …)
// subquery so concurrent saves on the same driver cannot collide on the
// unique (driver_id, revision_number) index. Mirror of
// snapshotSkillRevision in src/core/services/skill.ts.
async function snapshotDriverRevision(
  db: DbOrTx,
  row: DriverSelect,
  snapshotBy: string | null
): Promise<void> {
  await db.insert(driverRevision).values({
    driverId: row.id,
    revisionNumber: sql<number>`(
      SELECT COALESCE(MAX(${driverRevision.revisionNumber}), 0) + 1
      FROM ${driverRevision}
      WHERE ${driverRevision.driverId} = ${row.id}
    )`,
    name: row.name,
    slug: row.slug,
    binary: row.binary,
    defaultArgs: row.defaultArgs,
    modelFlag: row.modelFlag,
    dirFlag: row.dirFlag,
    sessionNameFlag: row.sessionNameFlag,
    promptTransport: row.promptTransport,
    outputFormat: row.outputFormat,
    outputFormatFlag: row.outputFormatFlag,
    promptSendDelayMs: row.promptSendDelayMs,
    probeCommand: row.probeCommand,
    issuePromptTemplate: row.issuePromptTemplate,
    queuePromptTemplate: row.queuePromptTemplate,
    envVars: row.envVars,
    extraArgs: row.extraArgs,
    contextLayout: row.contextLayout,
    isEnabled: row.isEnabled,
    notes: row.notes,
    snapshotBy,
  });
}

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

  create: protectedMutation(EDIT_ROLES)
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

  update: protectedMutation(EDIT_ROLES)
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
      // FLX-91: wrap update + snapshot in a transaction so a successful
      // update without a snapshot can never be observed.
      return await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .update(driver)
          .set({
            ...(data as any),
            version: version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(driver.id, id), eq(driver.version, version)))
          .returning();
        if (!row) throw new Error('Optimistic concurrency conflict');
        await snapshotDriverRevision(tx, row as DriverSelect, null);
        return row;
      });
    }),

  // FLX-91: list revisions for a driver, newest first.
  listHistory: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(driverRevision)
        .where(eq(driverRevision.driverId, input.id))
        .orderBy(desc(driverRevision.revisionNumber));
    }),

  // FLX-91: revert a driver to a snapshotted revision. Writes a NEW
  // revision capturing the reverted state (history is append-only).
  revertToRevision: protectedMutation(REVERT_ROLES)
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        revisionNumber: z.number().int().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await ctx.db.transaction(async (tx) => {
        const [target] = await tx
          .select()
          .from(driverRevision)
          .where(
            and(
              eq(driverRevision.driverId, input.id),
              eq(driverRevision.revisionNumber, input.revisionNumber)
            )
          );
        if (!target) {
          throw new Error(
            `Revision ${input.revisionNumber} not found for driver ${input.id}`
          );
        }
        const [row] = await tx
          .update(driver)
          .set({
            name: target.name,
            slug: target.slug,
            binary: target.binary,
            defaultArgs: target.defaultArgs as any,
            modelFlag: target.modelFlag,
            dirFlag: target.dirFlag,
            sessionNameFlag: target.sessionNameFlag,
            promptTransport: target.promptTransport,
            outputFormat: target.outputFormat,
            outputFormatFlag: target.outputFormatFlag,
            promptSendDelayMs: target.promptSendDelayMs,
            probeCommand: target.probeCommand,
            issuePromptTemplate: target.issuePromptTemplate,
            queuePromptTemplate: target.queuePromptTemplate,
            envVars: target.envVars as any,
            extraArgs: target.extraArgs as any,
            contextLayout: target.contextLayout,
            isEnabled: target.isEnabled,
            notes: target.notes,
            version: input.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(eq(driver.id, input.id), eq(driver.version, input.version))
          )
          .returning();
        if (!row) throw new Error('Optimistic concurrency conflict');
        await snapshotDriverRevision(tx, row as DriverSelect, null);
        return row;
      });
    }),

  delete: protectedMutation(DELETE_ROLES)
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
