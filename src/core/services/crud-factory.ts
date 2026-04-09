/**
 * Generic CRUD factory — DRY base for all entity services.
 *
 * Creates list/getById/create/update/delete operations for any Drizzle table.
 * Domain-specific services extend this with additional methods.
 */
import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import type { PgTable } from 'drizzle-orm/pg-core';

type AnyTable = PgTable & { id: any };

export interface CrudService<TInsert, TSelect> {
  list(): Promise<TSelect[]>;
  getById(id: string): Promise<TSelect | null>;
  create(data: TInsert): Promise<TSelect>;
  update(id: string, data: Partial<TInsert>): Promise<TSelect | null>;
  remove(id: string): Promise<void>;
}

export function createCrudService<TInsert, TSelect>(
  db: Database,
  table: AnyTable,
): CrudService<TInsert, TSelect> {
  return {
    async list(): Promise<TSelect[]> {
      const rows = await db.select().from(table);
      return rows as TSelect[];
    },

    async getById(id: string): Promise<TSelect | null> {
      const [row] = await db.select().from(table).where(eq(table.id, id));
      return (row as TSelect) ?? null;
    },

    async create(data: TInsert): Promise<TSelect> {
      const [row] = await db.insert(table).values(data as any).returning();
      return row as TSelect;
    },

    async update(id: string, data: Partial<TInsert>): Promise<TSelect | null> {
      const [row] = await db
        .update(table)
        .set({ ...data, updatedAt: new Date() } as any)
        .where(eq(table.id, id))
        .returning();
      return (row as TSelect) ?? null;
    },

    async remove(id: string): Promise<void> {
      await db.delete(table).where(eq(table.id, id));
    },
  };
}
