/**
 * Issue event service — append-only audit trail for issues.
 *
 * Events are the immutable record of everything that happens to an issue.
 * Other services call create() internally; list() supports tab-based filtering
 * for the UI timeline view.
 */
import { eq, and, asc, inArray } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { issueEvent } from '@/core/db/schema';

// ─── Inferred types ──────────────────────────────────────────────────────────

type IssueEventSelect = typeof issueEvent.$inferSelect;

// ─── Filter types ────────────────────────────────────────────────────────────

type EventFilter = 'all' | 'comments' | 'state' | 'pipeline';

const FILTER_TYPE_MAP: Record<Exclude<EventFilter, 'all'>, string[]> = {
  comments: ['comment_added', 'comment_edited', 'comment_deleted'],
  state: ['state_changed', 'status_changed', 'issue_created'],
  pipeline: ['stage_started', 'stage_completed', 'stage_failed', 'run_queued'],
};

// ─── Service factory ─────────────────────────────────────────────────────────

export function createIssueEventService(db: Database) {
  return {
    /**
     * List events for an issue, ordered by timestamp ASC.
     * Optionally filter by tab type.
     */
    async list(
      issueId: string,
      filter?: EventFilter,
    ): Promise<IssueEventSelect[]> {
      if (filter && filter !== 'all') {
        const types = FILTER_TYPE_MAP[filter];
        return db
          .select()
          .from(issueEvent)
          .where(
            and(
              eq(issueEvent.issueId, issueId),
              inArray(issueEvent.type, types),
            ),
          )
          .orderBy(asc(issueEvent.timestamp));
      }

      return db
        .select()
        .from(issueEvent)
        .where(eq(issueEvent.issueId, issueId))
        .orderBy(asc(issueEvent.timestamp));
    },

    /** Append-only insert. Used internally by other services. */
    async create(
      issueId: string,
      actor: string,
      type: string,
      payload: Record<string, unknown>,
    ): Promise<IssueEventSelect> {
      const [created] = await db
        .insert(issueEvent)
        .values({
          issueId,
          actor,
          type,
          payload,
        })
        .returning();

      return created;
    },
  };
}

export type IssueEventService = ReturnType<typeof createIssueEventService>;
