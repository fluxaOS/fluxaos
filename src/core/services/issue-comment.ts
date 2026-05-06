/**
 * Issue comment service — user content on issues.
 *
 * Comments are separate from events: events are the immutable audit trail,
 * comments are user-editable content. Soft-deleted comments retain their
 * row (for timeline continuity) but have body cleared — the original body
 * is captured in the event BEFORE clearing (DA Finding #18).
 *
 * Uses optimistic concurrency (version field) on all mutations.
 * Body HTML is rendered at write time from markdown.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { ISSUE_EVENT_TYPE } from '@/core/constants';
import type { Database } from '@/core/db/connection';
import { issueComment, issueEvent } from '@/core/db/schema';
import { renderMarkdown } from '@/core/markdown';

// ─── Inferred types ──────────────────────────────────────────────────────────

type IssueCommentSelect = typeof issueComment.$inferSelect;

// ─── Input types ─────────────────────────────────────────────────────────────

interface CreateCommentInput {
  bodyMd: string;
  author: string;
}

interface UpdateCommentInput {
  bodyMd: string;
  editedBy: string;
  version: number;
}

interface SoftDeleteCommentInput {
  deletedBy: string;
  version: number;
}

// ─── Service factory ─────────────────────────────────────────────────────────

export function createIssueCommentService(db: Database) {
  // ── Public API ───────────────────────────────────────────────────────────

  return {
    /**
     * List ALL comments for an issue, including soft-deleted ones.
     * Soft-deleted comments are returned with empty bodyMd/bodyHtml
     * to preserve timeline continuity.
     */
    async list(issueId: string): Promise<IssueCommentSelect[]> {
      return db
        .select()
        .from(issueComment)
        .where(eq(issueComment.issueId, issueId))
        .orderBy(asc(issueComment.commentNumber));
    },

    /**
     * Create a new comment on an issue.
     *
     * commentNumber is allocated inside a transaction with FOR UPDATE on the
     * existing comment rows — same pattern as issue.ts issue number allocation.
     * This serializes concurrent creates for the same issue; the unique index on
     * (issue_id, comment_number) is the last-resort guard.
     */
    async create(
      issueId: string,
      input: CreateCommentInput
    ): Promise<IssueCommentSelect> {
      const bodyHtml = renderMarkdown(input.bodyMd);

      return db.transaction(async (tx) => {
        const rows = await tx.execute(
          sql`SELECT COALESCE(MAX(comment_number), 0) + 1 AS "nextNumber" FROM (SELECT comment_number FROM issue_comment WHERE issue_id = ${issueId} FOR UPDATE) AS locked`
        );
        const nextNumber = Number(
          (rows as unknown as Array<{ nextNumber: number }>)[0].nextNumber
        );

        const [created] = await tx
          .insert(issueComment)
          .values({
            issueId,
            commentNumber: nextNumber,
            bodyMd: input.bodyMd,
            bodyHtml,
            author: input.author,
          })
          .returning();

        await tx.insert(issueEvent).values({
          issueId,
          actor: input.author,
          type: ISSUE_EVENT_TYPE.comment_added,
          payload: { comment_id: created.id, author: input.author },
        });

        return created;
      });
    },

    /**
     * Update a comment's body. Uses optimistic concurrency.
     * Records the old and new body in the event trail.
     *
     * All writes (version-guarded update + event insert) run inside a single
     * db.transaction so any failure rolls back cleanly — no half-applied state.
     */
    async update(
      commentId: string,
      input: UpdateCommentInput
    ): Promise<IssueCommentSelect> {
      return db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(issueComment)
          .where(eq(issueComment.id, commentId));
        if (!current) {
          throw new Error(`Comment ${commentId} not found.`);
        }
        if (current.version !== input.version) {
          throw new Error(
            `VERSION_CONFLICT: Expected version ${input.version}, but comment has version ${current.version}. Reload and retry.`
          );
        }

        const bodyHtml = renderMarkdown(input.bodyMd);

        const [updated] = await tx
          .update(issueComment)
          .set({
            bodyMd: input.bodyMd,
            bodyHtml,
            editedAt: new Date(),
            version: input.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(issueComment.id, commentId),
              eq(issueComment.version, input.version)
            )
          )
          .returning();

        if (!updated) {
          throw new Error(
            `VERSION_CONFLICT: Comment ${commentId} was modified concurrently. Reload and retry.`
          );
        }

        await tx.insert(issueEvent).values({
          issueId: current.issueId,
          actor: input.editedBy,
          type: ISSUE_EVENT_TYPE.comment_edited,
          payload: {
            comment_id: commentId,
            old_body: current.bodyMd,
            new_body: input.bodyMd,
            edited_by: input.editedBy,
          },
        });

        return updated;
      });
    },

    /**
     * Soft-delete a comment.
     *
     * CRITICAL (DA Finding #18): The body is captured in the event BEFORE
     * being cleared from the comment row. This preserves content in the
     * audit trail while showing "[deleted]" in the UI.
     *
     * All writes (event insert + version-guarded update) run inside a single
     * db.transaction so any failure rolls back cleanly — no half-applied state
     * (e.g. event inserted but update rejected by a concurrent version bump).
     */
    async softDelete(
      commentId: string,
      input: SoftDeleteCommentInput
    ): Promise<IssueCommentSelect> {
      return db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(issueComment)
          .where(eq(issueComment.id, commentId));
        if (!current) {
          throw new Error(`Comment ${commentId} not found.`);
        }
        if (current.version !== input.version) {
          throw new Error(
            `VERSION_CONFLICT: Expected version ${input.version}, but comment has version ${current.version}. Reload and retry.`
          );
        }

        // Record event FIRST — captures body before it's cleared
        await tx.insert(issueEvent).values({
          issueId: current.issueId,
          actor: input.deletedBy,
          type: ISSUE_EVENT_TYPE.comment_deleted,
          payload: {
            comment_id: commentId,
            body_md: current.bodyMd,
            deleted_by: input.deletedBy,
          },
        });

        // THEN clear the comment body
        const [updated] = await tx
          .update(issueComment)
          .set({
            isDeleted: true,
            bodyMd: '',
            bodyHtml: '',
            version: input.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(issueComment.id, commentId),
              eq(issueComment.version, input.version)
            )
          )
          .returning();

        if (!updated) {
          throw new Error(
            `VERSION_CONFLICT: Comment ${commentId} was modified concurrently. Reload and retry.`
          );
        }

        return updated;
      });
    },
  };
}

export type IssueCommentService = ReturnType<typeof createIssueCommentService>;
