/**
 * Issue catalog service — CRUD for all 6 catalog types.
 *
 * Key design decisions:
 * - list() always filters isActive=true, ordered by sortOrder (or weight for priorities)
 * - listAll() includes inactive items (for admin/settings pages)
 * - deactivate() instead of delete (RESTRICT FKs prevent hard-delete when referenced)
 * - transitions get hard-delete (no RESTRICT from other tables)
 */
import { eq, and } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import {
  issueType,
  issueState,
  issueStatus,
  issuePriority,
  issueLabel,
  issueTransition,
} from '@/core/db/schema';
import type { PgTable, PgColumn } from 'drizzle-orm/pg-core';

// ─── Inferred types ───────────────────────────────────────────────────────────

type IssueTypeInsert = typeof issueType.$inferInsert;
type IssueTypeSelect = typeof issueType.$inferSelect;

type IssueStateInsert = typeof issueState.$inferInsert;
type IssueStateSelect = typeof issueState.$inferSelect;

type IssueStatusInsert = typeof issueStatus.$inferInsert;
type IssueStatusSelect = typeof issueStatus.$inferSelect;

type IssuePriorityInsert = typeof issuePriority.$inferInsert;
type IssuePrioritySelect = typeof issuePriority.$inferSelect;

type IssueLabelInsert = typeof issueLabel.$inferInsert;
type IssueLabelSelect = typeof issueLabel.$inferSelect;

type IssueTransitionInsert = typeof issueTransition.$inferInsert;
type IssueTransitionSelect = typeof issueTransition.$inferSelect;

// ─── Catalog table shape ──────────────────────────────────────────────────────

type CatalogTable = PgTable & {
  id: PgColumn;
  projectId: PgColumn;
  key: PgColumn;
  isActive: PgColumn;
};

type SortableCatalogTable = CatalogTable & { sortOrder: PgColumn };
type WeightedCatalogTable = CatalogTable & { weight: PgColumn };

// ─── Generic catalog CRUD (sortOrder-based) ───────────────────────────────────

function createCatalogCrud<TInsert, TSelect>(
  db: Database,
  table: SortableCatalogTable,
) {
  return {
    async list(projectId: string): Promise<TSelect[]> {
      return db
        .select()
        .from(table)
        .where(and(eq(table.projectId, projectId), eq(table.isActive, true)))
        .orderBy(table.sortOrder) as Promise<TSelect[]>;
    },

    async listAll(projectId: string): Promise<TSelect[]> {
      return db
        .select()
        .from(table)
        .where(eq(table.projectId, projectId))
        .orderBy(table.sortOrder) as Promise<TSelect[]>;
    },

    async getByKey(projectId: string, key: string): Promise<TSelect | null> {
      const [row] = await db
        .select()
        .from(table)
        .where(and(eq(table.projectId, projectId), eq(table.key, key)));
      return (row as TSelect) ?? null;
    },

    async getById(id: string): Promise<TSelect | null> {
      const [row] = await db.select().from(table).where(eq(table.id, id));
      return (row as TSelect) ?? null;
    },

    async create(data: TInsert): Promise<TSelect> {
      const [row] = await db
        .insert(table)
        .values(data as any)
        .returning();
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

    async deactivate(id: string): Promise<TSelect | null> {
      const [row] = await db
        .update(table)
        .set({ isActive: false, updatedAt: new Date() } as any)
        .where(eq(table.id, id))
        .returning();
      return (row as TSelect) ?? null;
    },
  };
}

// ─── Priority catalog CRUD (weight-based ordering) ────────────────────────────

function createPriorityCrud<TInsert, TSelect>(
  db: Database,
  table: WeightedCatalogTable,
) {
  return {
    async list(projectId: string): Promise<TSelect[]> {
      return db
        .select()
        .from(table)
        .where(and(eq(table.projectId, projectId), eq(table.isActive, true)))
        .orderBy(table.weight) as Promise<TSelect[]>;
    },

    async listAll(projectId: string): Promise<TSelect[]> {
      return db
        .select()
        .from(table)
        .where(eq(table.projectId, projectId))
        .orderBy(table.weight) as Promise<TSelect[]>;
    },

    async getByKey(projectId: string, key: string): Promise<TSelect | null> {
      const [row] = await db
        .select()
        .from(table)
        .where(and(eq(table.projectId, projectId), eq(table.key, key)));
      return (row as TSelect) ?? null;
    },

    async getById(id: string): Promise<TSelect | null> {
      const [row] = await db.select().from(table).where(eq(table.id, id));
      return (row as TSelect) ?? null;
    },

    async create(data: TInsert): Promise<TSelect> {
      const [row] = await db
        .insert(table)
        .values(data as any)
        .returning();
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

    async deactivate(id: string): Promise<TSelect | null> {
      const [row] = await db
        .update(table)
        .set({ isActive: false, updatedAt: new Date() } as any)
        .where(eq(table.id, id))
        .returning();
      return (row as TSelect) ?? null;
    },
  };
}

// ─── Main service factory ─────────────────────────────────────────────────────

export function createIssueCatalogService(db: Database) {
  return {
    types: createCatalogCrud<IssueTypeInsert, IssueTypeSelect>(
      db,
      issueType as unknown as SortableCatalogTable,
    ),
    states: createCatalogCrud<IssueStateInsert, IssueStateSelect>(
      db,
      issueState as unknown as SortableCatalogTable,
    ),
    statuses: createCatalogCrud<IssueStatusInsert, IssueStatusSelect>(
      db,
      issueStatus as unknown as SortableCatalogTable,
    ),
    priorities: createPriorityCrud<IssuePriorityInsert, IssuePrioritySelect>(
      db,
      issuePriority as unknown as WeightedCatalogTable,
    ),
    labels: createCatalogCrud<IssueLabelInsert, IssueLabelSelect>(
      db,
      issueLabel as unknown as SortableCatalogTable,
    ),

    transitions: {
      async list(projectId: string): Promise<IssueTransitionSelect[]> {
        return db
          .select()
          .from(issueTransition)
          .where(
            and(
              eq(issueTransition.projectId, projectId),
              eq(issueTransition.isActive, true),
            ),
          )
          .orderBy(issueTransition.sortOrder);
      },

      async listFrom(
        projectId: string,
        fromStateId: string,
      ): Promise<IssueTransitionSelect[]> {
        return db
          .select()
          .from(issueTransition)
          .where(
            and(
              eq(issueTransition.projectId, projectId),
              eq(issueTransition.fromStateId, fromStateId),
              eq(issueTransition.isActive, true),
            ),
          )
          .orderBy(issueTransition.sortOrder);
      },

      async create(
        data: IssueTransitionInsert,
      ): Promise<IssueTransitionSelect> {
        const [row] = await db
          .insert(issueTransition)
          .values(data)
          .returning();
        return row;
      },

      async delete(id: string): Promise<void> {
        await db
          .delete(issueTransition)
          .where(eq(issueTransition.id, id));
      },
    },
  };
}

export type IssueCatalogService = ReturnType<typeof createIssueCatalogService>;
