import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { nextRevisionNumber } from '@/core/db/revision';
import {
  driver,
  driverRevision,
  pipelineStage,
  stageRun,
} from '@/core/db/schema';
import { NotFoundError } from '@/core/errors/domain';
import {
  resolveScoped,
  resolveScopedAll,
  type ScopeContext,
} from './resolve-scoped';

type DbOrTx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;
type DriverSelect = typeof driver.$inferSelect;
type DriverRevisionSelect = typeof driverRevision.$inferSelect;

export interface CreateDriverInput {
  name: string;
  slug: string;
  binary: string;
  defaultArgs?: string[];
  modelFlag?: string;
  dirFlag?: string;
  sessionNameFlag?: string;
  promptTransport?: string;
  outputFormat?: string;
  outputFormatFlag?: string;
  promptSendDelayMs?: number;
  probeCommand?: string;
  issuePromptTemplate?: string;
  queuePromptTemplate?: string;
  envVars?: Record<string, string>;
  extraArgs?: Record<string, unknown>;
  contextLayout?: unknown;
  isEnabled?: boolean;
  notes?: string;
}

export interface UpdateDriverInput {
  name?: string;
  slug?: string;
  binary?: string;
  defaultArgs?: string[];
  modelFlag?: string | null;
  dirFlag?: string | null;
  sessionNameFlag?: string | null;
  promptTransport?: string;
  outputFormat?: string;
  outputFormatFlag?: string | null;
  promptSendDelayMs?: number;
  probeCommand?: string | null;
  issuePromptTemplate?: string | null;
  queuePromptTemplate?: string | null;
  envVars?: Record<string, string>;
  extraArgs?: Record<string, unknown>;
  contextLayout?: unknown;
  isEnabled?: boolean;
  notes?: string | null;
}

// FLX-91: append a driver_revision row capturing the post-update state.
// Computes the next revision_number atomically via a (SELECT max+1 …)
// subquery so concurrent saves on the same driver cannot collide on the
// unique (driver_id, revision_number) index.
async function snapshotDriverRevision(
  db: DbOrTx,
  row: DriverSelect,
  snapshotBy: string | null
): Promise<void> {
  await db.insert(driverRevision).values({
    driverId: row.id,
    revisionNumber: nextRevisionNumber(
      driverRevision,
      driverRevision.driverId,
      row.id
    ),
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

export function createDriverService(db: Database) {
  return {
    async list(): Promise<DriverSelect[]> {
      return db.select().from(driver).orderBy(driver.name);
    },

    async listEffective(scope: ScopeContext): Promise<DriverSelect[]> {
      return resolveScopedAll<DriverSelect>(db, driver, scope, 'name');
    },

    async resolveEffectiveById(
      id: string,
      scope: ScopeContext
    ): Promise<DriverSelect | null> {
      const [base] = await db.select().from(driver).where(eq(driver.id, id));
      if (!base) return null;
      return resolveScoped<DriverSelect>(
        db,
        driver,
        scope,
        eq(driver.name, base.name)
      );
    },

    async getBySlug(slug: string): Promise<DriverSelect | null> {
      const [row] = await db.select().from(driver).where(eq(driver.slug, slug));
      return row ?? null;
    },

    async getById(id: string): Promise<DriverSelect | null> {
      const [row] = await db.select().from(driver).where(eq(driver.id, id));
      return row ?? null;
    },

    async create(data: CreateDriverInput): Promise<DriverSelect> {
      const [row] = await db
        .insert(driver)
        .values({
          ...data,
          defaultArgs: (data.defaultArgs ?? []) as never,
          envVars: (data.envVars ?? {}) as never,
          extraArgs: (data.extraArgs ?? {}) as never,
          contextLayout: data.contextLayout as never,
        })
        .returning();
      return row;
    },

    async update(
      id: string,
      version: number,
      data: UpdateDriverInput
    ): Promise<DriverSelect> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(driver)
          .set({
            ...data,
            ...(data.defaultArgs !== undefined && {
              defaultArgs: data.defaultArgs as never,
            }),
            ...(data.envVars !== undefined && {
              envVars: data.envVars as never,
            }),
            ...(data.extraArgs !== undefined && {
              extraArgs: data.extraArgs as never,
            }),
            ...(data.contextLayout !== undefined && {
              contextLayout: data.contextLayout as never,
            }),
            version: version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(driver.id, id), eq(driver.version, version)))
          .returning();
        if (!row) throw new Error('Optimistic concurrency conflict');
        await snapshotDriverRevision(tx, row as DriverSelect, null);
        return row;
      });
    },

    async listHistory(driverId: string): Promise<DriverRevisionSelect[]> {
      return db
        .select()
        .from(driverRevision)
        .where(eq(driverRevision.driverId, driverId))
        .orderBy(desc(driverRevision.revisionNumber));
    },

    async revertToRevision(
      id: string,
      version: number,
      revisionNumber: number
    ): Promise<DriverSelect> {
      return db.transaction(async (tx) => {
        const [target] = await tx
          .select()
          .from(driverRevision)
          .where(
            and(
              eq(driverRevision.driverId, id),
              eq(driverRevision.revisionNumber, revisionNumber)
            )
          );
        if (!target) {
          throw new Error(
            `Revision ${revisionNumber} not found for driver ${id}`
          );
        }
        const [row] = await tx
          .update(driver)
          .set({
            name: target.name,
            slug: target.slug,
            binary: target.binary,
            defaultArgs: target.defaultArgs as never,
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
            envVars: target.envVars as never,
            extraArgs: target.extraArgs as never,
            contextLayout: target.contextLayout as never,
            isEnabled: target.isEnabled,
            notes: target.notes,
            version: version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(driver.id, id), eq(driver.version, version)))
          .returning();
        if (!row) throw new Error('Optimistic concurrency conflict');
        await snapshotDriverRevision(tx, row as DriverSelect, null);
        return row;
      });
    },

    async delete(id: string, version: number): Promise<DriverSelect> {
      // Wrap FK count + version-locked delete in a transaction so a concurrent
      // insert between the count and the delete cannot orphan a reference.
      return db.transaction(async (tx) => {
        const [{ pipelineStages, stageRuns }] = await tx
          .select({
            pipelineStages: sql<number>`count(distinct ${pipelineStage.id})`,
            stageRuns: sql<number>`count(distinct ${stageRun.id})`,
          })
          .from(driver)
          .leftJoin(pipelineStage, eq(pipelineStage.driverId, driver.id))
          .leftJoin(stageRun, eq(stageRun.driverId, driver.id))
          .where(eq(driver.id, id));

        const pStages = Number(pipelineStages);
        const sRuns = Number(stageRuns);
        if (pStages + sRuns > 0) {
          throw new Error(
            `Cannot delete driver — referenced by ${pStages} pipeline stage(s) and ${sRuns} stage run(s). Remove references first.`
          );
        }

        const [row] = await tx
          .delete(driver)
          .where(and(eq(driver.id, id), eq(driver.version, version)))
          .returning();
        if (!row) {
          const [exists] = await tx
            .select({ version: driver.version })
            .from(driver)
            .where(eq(driver.id, id));
          if (!exists) throw new NotFoundError(`Driver not found: ${id}`);
          throw new Error('Optimistic concurrency conflict');
        }
        return row;
      });
    },
  };
}

export type DriverService = ReturnType<typeof createDriverService>;
