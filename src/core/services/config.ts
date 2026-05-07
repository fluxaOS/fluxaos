import { and, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { configEntry } from '@/core/db/schema';
import { NotFoundError } from '@/core/errors/domain';
import { createVersionedCrudService } from './crud-factory';

type ConfigEntryInsert = typeof configEntry.$inferInsert;
type ConfigEntrySelect = typeof configEntry.$inferSelect;

export interface CreateConfigInput {
  scope: string;
  projectId?: string | null;
  key: string;
  value: unknown;
  changedBy?: string | null;
}

export interface UpdateConfigInput {
  scope?: string;
  key?: string;
  value?: unknown;
  changedBy?: string | null;
}

export function createConfigService(db: Database) {
  const versioned = createVersionedCrudService<
    ConfigEntryInsert,
    ConfigEntrySelect
  >(db, configEntry);

  return {
    async list(): Promise<ConfigEntrySelect[]> {
      return db.select().from(configEntry).orderBy(configEntry.key);
    },

    async listByProject(projectId: string): Promise<ConfigEntrySelect[]> {
      return db
        .select()
        .from(configEntry)
        .where(eq(configEntry.projectId, projectId))
        .orderBy(configEntry.key);
    },

    async getById(id: string): Promise<ConfigEntrySelect | null> {
      return versioned.getById(id);
    },

    async create(data: CreateConfigInput): Promise<ConfigEntrySelect> {
      const [row] = await db
        .insert(configEntry)
        .values({
          scope: data.scope,
          projectId: data.projectId ?? null,
          key: data.key,
          value: data.value as never,
          changedBy: data.changedBy ?? null,
        } as ConfigEntryInsert)
        .returning();
      return row;
    },

    async update(
      id: string,
      version: number,
      data: UpdateConfigInput
    ): Promise<ConfigEntrySelect> {
      return db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(configEntry)
          .where(eq(configEntry.id, id));
        if (!current) throw new NotFoundError(`Config entry not found: ${id}`);

        const patch: Partial<ConfigEntryInsert> = {
          ...data,
        } as Partial<ConfigEntryInsert>;
        if (data.value !== undefined) {
          (patch as Record<string, unknown>).previousValue = current.value;
        }

        const [row] = await tx
          .update(configEntry)
          .set({
            ...(patch as Record<string, unknown>),
            version: version + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(configEntry.id, id), eq(configEntry.version, version)))
          .returning();
        if (!row) throw new Error('Optimistic concurrency conflict');
        return row;
      });
    },

    async delete(id: string, version: number): Promise<ConfigEntrySelect> {
      const [row] = await db
        .delete(configEntry)
        .where(and(eq(configEntry.id, id), eq(configEntry.version, version)))
        .returning();
      if (!row) {
        const existing = await versioned.getById(id);
        if (!existing) throw new NotFoundError(`Config entry not found: ${id}`);
        throw new Error('Optimistic concurrency conflict');
      }
      return row;
    },
  };
}

export type ConfigService = ReturnType<typeof createConfigService>;
