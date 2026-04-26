/**
 * Generic CRUD factories — DRY base for all entity services.
 *
 * Two variants:
 *   - createCrudService: basic list/getById/create/update/remove (no concurrency)
 *   - createVersionedCrudService: adds updateWithVersion / deleteWithVersion for
 *     entities that need optimistic concurrency (invariant 12)
 *
 * Both variants require the table to expose an `id` UUID column. The versioned
 * variant additionally requires an integer `version` column.
 */
import { and, eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '@/core/db/connection';

type WithIdColumn = { id: PgColumn };
type WithVersionColumn = { version: PgColumn };
type WithUpdatedAtColumn = { updatedAt: PgColumn };

export interface CrudService<TInsert, TSelect> {
  list(): Promise<TSelect[]>;
  getById(id: string): Promise<TSelect | null>;
  create(data: TInsert): Promise<TSelect>;
  update(id: string, data: Partial<TInsert>): Promise<TSelect | null>;
  remove(id: string): Promise<boolean>;
}

export interface VersionedCrudService<TInsert, TSelect>
  extends CrudService<TInsert, TSelect> {
  updateWithVersion(
    id: string,
    expectedVersion: number,
    data: Partial<TInsert>
  ): Promise<TSelect | null>;
  deleteWithVersion(id: string, expectedVersion: number): Promise<boolean>;
}

export function createCrudService<TInsert, TSelect>(
  db: Database,
  table: PgTable & WithIdColumn & WithUpdatedAtColumn
): CrudService<TInsert, TSelect> {
  return {
    async list(): Promise<TSelect[]> {
      return (await db.select().from(table)) as TSelect[];
    },
    async getById(id: string): Promise<TSelect | null> {
      const [row] = await db.select().from(table).where(eq(table.id, id));
      return (row as TSelect | undefined) ?? null;
    },
    async create(data: TInsert): Promise<TSelect> {
      const [row] = await db
        .insert(table)
        .values(data as Record<string, unknown>)
        .returning();
      return row as TSelect;
    },
    async update(id: string, data: Partial<TInsert>): Promise<TSelect | null> {
      const [row] = await db
        .update(table)
        .set({
          ...(data as Record<string, unknown>),
          updatedAt: new Date(),
        })
        .where(eq(table.id, id))
        .returning();
      return (row as TSelect | undefined) ?? null;
    },
    async remove(id: string): Promise<boolean> {
      const rows = await db
        .delete(table)
        .where(eq(table.id, id))
        .returning({ id: table.id });
      return rows.length > 0;
    },
  };
}

export function createVersionedCrudService<TInsert, TSelect>(
  db: Database,
  table: PgTable & WithIdColumn & WithVersionColumn & WithUpdatedAtColumn
): VersionedCrudService<TInsert, TSelect> {
  const base = createCrudService<TInsert, TSelect>(db, table);

  return {
    ...base,
    async updateWithVersion(
      id: string,
      expectedVersion: number,
      data: Partial<TInsert>
    ): Promise<TSelect | null> {
      const [row] = await db
        .update(table)
        .set({
          ...(data as Record<string, unknown>),
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(table.id, id), eq(table.version, expectedVersion)))
        .returning();
      return (row as TSelect | undefined) ?? null;
    },
    async deleteWithVersion(
      id: string,
      expectedVersion: number
    ): Promise<boolean> {
      const rows = await db
        .delete(table)
        .where(and(eq(table.id, id), eq(table.version, expectedVersion)))
        .returning({ id: table.id });
      return rows.length > 0;
    },
  };
}
