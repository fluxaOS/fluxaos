/**
 * Issue dependency service — manages blocking relationships between issues.
 *
 * An issue_dependency row means: issueId depends on (is blocked by) dependsOnIssueId.
 * The list method returns both directions for a given issue.
 */
import { eq, or } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { issueDependency, issueEvent } from '@/core/db/schema';

// ─── Inferred types ──────────────────────────────────────────────────────────

type IssueDependencySelect = typeof issueDependency.$inferSelect;

// ─── Output types ────────────────────────────────────────────────────────────

interface DependencyList {
  /** Issues that this issue depends on (blocks this issue). */
  blockedBy: IssueDependencySelect[];
  /** Issues that depend on this issue (this issue blocks them). */
  blocking: IssueDependencySelect[];
}

// ─── Service factory ─────────────────────────────────────────────────────────

export function createIssueDependencyService(db: Database) {
  // ── Helpers ──────────────────────────────────────────────────────────────

  async function recordEvent(
    issueId: string,
    actor: string,
    type: string,
    payload: Record<string, unknown>,
  ) {
    await db.insert(issueEvent).values({
      issueId,
      actor,
      type,
      payload,
    });
  }

  // ── Public API ───────────────────────────────────────────────────────────

  return {
    /**
     * List all dependencies involving this issue in both directions.
     * - blockedBy: rows where issueId = this issue (this issue depends on something)
     * - blocking: rows where dependsOnIssueId = this issue (something depends on this issue)
     */
    async list(issueId: string): Promise<DependencyList> {
      const rows = await db
        .select()
        .from(issueDependency)
        .where(
          or(
            eq(issueDependency.issueId, issueId),
            eq(issueDependency.dependsOnIssueId, issueId),
          ),
        );

      const blockedBy: IssueDependencySelect[] = [];
      const blocking: IssueDependencySelect[] = [];

      for (const row of rows) {
        if (row.issueId === issueId) {
          blockedBy.push(row);
        }
        if (row.dependsOnIssueId === issueId) {
          blocking.push(row);
        }
      }

      return { blockedBy, blocking };
    },

    /** Create a dependency and record an event. */
    async create(
      projectId: string,
      issueId: string,
      dependsOnIssueId: string,
      dependencyType?: string,
    ): Promise<IssueDependencySelect> {
      const [created] = await db
        .insert(issueDependency)
        .values({
          projectId,
          issueId,
          dependsOnIssueId,
          ...(dependencyType ? { dependencyType } : {}),
        })
        .returning();

      await recordEvent(issueId, 'system', 'dependency_added', {
        depends_on_issue_id: dependsOnIssueId,
        dependency_type: created.dependencyType,
      });

      return created;
    },

    /** Hard-delete a dependency and record an event. */
    async delete(dependencyId: string, issueId: string): Promise<void> {
      const [row] = await db
        .select()
        .from(issueDependency)
        .where(eq(issueDependency.id, dependencyId));

      if (!row) {
        throw new Error(`Dependency ${dependencyId} not found.`);
      }

      await db
        .delete(issueDependency)
        .where(eq(issueDependency.id, dependencyId));

      await recordEvent(issueId, 'system', 'dependency_removed', {
        depends_on_issue_id: row.dependsOnIssueId,
      });
    },
  };
}

export type IssueDependencyService = ReturnType<typeof createIssueDependencyService>;
