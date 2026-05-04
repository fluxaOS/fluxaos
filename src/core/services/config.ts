import { and, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { configEntry } from '@/core/db/schema';

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
  return {
    async list(): Promise<ConfigEntrySelect[]> {
      return db.select().from(configEntry).orderBy(configEntry.key);
    },

    async getById(id: string): Promise<ConfigEntrySelect | null> {
      const [row] = await db
        .select()
        .from(configEntry)
        .where(eq(configEntry.id, id));
      return row ?? null;
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
      const [current] = await db
        .select()
        .from(configEntry)
        .where(eq(configEntry.id, id));
      if (!current) throw new Error(`Config entry not found: ${id}`);

      const patch: Record<string, unknown> = {
        ...data,
        version: version + 1,
        updatedAt: new Date(),
      };
      if (data.value !== undefined) {
        patch.value = data.value;
        patch.previousValue = current.value;
      }

      const [row] = await db
        .update(configEntry)
        .set(patch as never)
        .where(and(eq(configEntry.id, id), eq(configEntry.version, version)))
        .returning();
      if (!row) throw new Error('Optimistic concurrency conflict');
      return row;
    },

    async delete(id: string, version: number): Promise<ConfigEntrySelect> {
      const [row] = await db
        .delete(configEntry)
        .where(and(eq(configEntry.id, id), eq(configEntry.version, version)))
        .returning();
      if (!row) {
        const [exists] = await db
          .select({ version: configEntry.version })
          .from(configEntry)
          .where(eq(configEntry.id, id));
        if (!exists) throw new Error(`Config entry not found: ${id}`);
        throw new Error('Optimistic concurrency conflict');
      }
      return row;
    },
  };
}

export type ConfigService = ReturnType<typeof createConfigService>;
