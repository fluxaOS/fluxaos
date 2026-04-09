/**
 * Issue saved view service — persisted filter/sort configurations.
 *
 * Views belong to a project and store filter criteria, sort preferences,
 * and an optional default flag. Only one view per project can be default.
 */
import { eq, and, asc, ne } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { issueSavedView } from '@/core/db/schema';

// ─── Inferred types ──────────────────────────────────────────────────────────

type IssueSavedViewSelect = typeof issueSavedView.$inferSelect;

// ─── Input types ─────────────────────────────────────────────────────────────

interface CreateSavedViewInput {
  name: string;
  filters: unknown;
  sortField?: string;
  sortOrder?: string;
  limit?: number;
  isDefault?: boolean;
  createdBy?: string;
}

interface UpdateSavedViewInput {
  name?: string;
  filters?: unknown;
  sortField?: string | null;
  sortOrder?: string | null;
  limit?: number | null;
  isDefault?: boolean;
}

// ─── Service factory ─────────────────────────────────────────────────────────

export function createIssueSavedViewService(db: Database) {
  return {
    /** List all saved views for a project, ordered by name. */
    async list(projectId: string): Promise<IssueSavedViewSelect[]> {
      return db
        .select()
        .from(issueSavedView)
        .where(eq(issueSavedView.projectId, projectId))
        .orderBy(asc(issueSavedView.name));
    },

    /** Create a new saved view. */
    async create(
      projectId: string,
      input: CreateSavedViewInput,
    ): Promise<IssueSavedViewSelect> {
      const [created] = await db
        .insert(issueSavedView)
        .values({
          projectId,
          name: input.name,
          filters: input.filters,
          sortField: input.sortField,
          sortOrder: input.sortOrder,
          limit: input.limit,
          isDefault: input.isDefault ?? false,
          createdBy: input.createdBy,
        })
        .returning();

      return created;
    },

    /** Update a saved view's fields. */
    async update(
      viewId: string,
      fields: UpdateSavedViewInput,
    ): Promise<IssueSavedViewSelect> {
      const [updated] = await db
        .update(issueSavedView)
        .set({
          ...fields,
          updatedAt: new Date(),
        })
        .where(eq(issueSavedView.id, viewId))
        .returning();

      if (!updated) {
        throw new Error(`Saved view ${viewId} not found.`);
      }

      return updated;
    },

    /** Hard-delete a saved view. */
    async delete(viewId: string): Promise<void> {
      await db
        .delete(issueSavedView)
        .where(eq(issueSavedView.id, viewId));
    },

    /**
     * Set a view as the default for its project.
     * Unsets any other default first, then sets the target.
     */
    async setDefault(
      projectId: string,
      viewId: string,
    ): Promise<IssueSavedViewSelect> {
      // Unset all defaults for this project
      await db
        .update(issueSavedView)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(
          and(
            eq(issueSavedView.projectId, projectId),
            eq(issueSavedView.isDefault, true),
          ),
        );

      // Set the target as default
      const [updated] = await db
        .update(issueSavedView)
        .set({ isDefault: true, updatedAt: new Date() })
        .where(eq(issueSavedView.id, viewId))
        .returning();

      if (!updated) {
        throw new Error(`Saved view ${viewId} not found.`);
      }

      return updated;
    },
  };
}

export type IssueSavedViewService = ReturnType<typeof createIssueSavedViewService>;
