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
import { eq, and, asc, sql } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { issueComment, issueEvent } from '@/core/db/schema';

// ─── Inferred types ──────────────────────────────────────────────────────────

type IssueCommentInsert = typeof issueComment.$inferInsert;
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

// ─── Markdown renderer (placeholder) ─────────────────────────────────────────

function renderMarkdown(md: string): string {
  // Minimal: escape HTML, convert newlines to <br>, wrap in <p>
  // A proper markdown library will replace this later
  return (
    '<p>' +
    md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>') +
    '</p>'
  );
}

// ─── Service factory ─────────────────────────────────────────────────────────

export function createIssueCommentService(db: Database) {
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

  async function loadComment(commentId: string): Promise<IssueCommentSelect> {
    const [row] = await db
      .select()
      .from(issueComment)
      .where(eq(issueComment.id, commentId));

    if (!row) {
      throw new Error(`Comment ${commentId} not found.`);
    }
    return row;
  }

  function assertVersion(current: IssueCommentSelect, expected: number) {
    if (current.version !== expected) {
      throw new Error(
        `VERSION_CONFLICT: Expected version ${expected}, but comment has version ${current.version}. Reload and retry.`,
      );
    }
  }

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
     * Allocates next commentNumber, renders HTML, records event.
     */
    async create(
      issueId: string,
      input: CreateCommentInput,
    ): Promise<IssueCommentSelect> {
      const bodyHtml = renderMarkdown(input.bodyMd);

      // Allocate next comment number
      const rows = await db.execute(
        sql`SELECT COALESCE(MAX(comment_number), 0) + 1 AS "nextNumber" FROM issue_comment WHERE issue_id = ${issueId}`,
      );
      const nextNumber = Number(
        (rows as unknown as Array<{ nextNumber: number }>)[0].nextNumber,
      );

      const [created] = await db
        .insert(issueComment)
        .values({
          issueId,
          commentNumber: nextNumber,
          bodyMd: input.bodyMd,
          bodyHtml,
          author: input.author,
        })
        .returning();

      await recordEvent(issueId, input.author, 'comment_added', {
        comment_id: created.id,
        author: input.author,
      });

      return created;
    },

    /**
     * Update a comment's body. Uses optimistic concurrency.
     * Records the old and new body in the event trail.
     */
    async update(
      commentId: string,
      input: UpdateCommentInput,
    ): Promise<IssueCommentSelect> {
      const current = await loadComment(commentId);
      assertVersion(current, input.version);

      const bodyHtml = renderMarkdown(input.bodyMd);

      const [updated] = await db
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
            eq(issueComment.version, input.version),
          ),
        )
        .returning();

      if (!updated) {
        throw new Error(
          `VERSION_CONFLICT: Comment ${commentId} was modified concurrently. Reload and retry.`,
        );
      }

      await recordEvent(current.issueId, input.editedBy, 'comment_edited', {
        comment_id: commentId,
        old_body: current.bodyMd,
        new_body: input.bodyMd,
        edited_by: input.editedBy,
      });

      return updated;
    },

    /**
     * Soft-delete a comment.
     *
     * CRITICAL (DA Finding #18): The body is captured in the event BEFORE
     * being cleared from the comment row. This preserves content in the
     * audit trail while showing "[deleted]" in the UI.
     */
    async softDelete(
      commentId: string,
      input: SoftDeleteCommentInput,
    ): Promise<IssueCommentSelect> {
      const current = await loadComment(commentId);
      assertVersion(current, input.version);

      // Record event FIRST — captures body before it's cleared
      await recordEvent(current.issueId, input.deletedBy, 'comment_deleted', {
        comment_id: commentId,
        body_md: current.bodyMd,
        deleted_by: input.deletedBy,
      });

      // THEN clear the comment body
      const [updated] = await db
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
            eq(issueComment.version, input.version),
          ),
        )
        .returning();

      if (!updated) {
        throw new Error(
          `VERSION_CONFLICT: Comment ${commentId} was modified concurrently. Reload and retry.`,
        );
      }

      return updated;
    },
  };
}

export type IssueCommentService = ReturnType<typeof createIssueCommentService>;
