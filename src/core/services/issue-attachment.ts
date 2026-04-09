/**
 * Issue attachment service — file attachments on issues.
 *
 * Hard-deletes attachments (no soft delete needed for files).
 * Records events on create and delete for audit trail.
 */
import { eq, desc } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { issueAttachment, issueEvent } from '@/core/db/schema';

// ─── Inferred types ──────────────────────────────────────────────────────────

type IssueAttachmentSelect = typeof issueAttachment.$inferSelect;

// ─── Input types ─────────────────────────────────────────────────────────────

interface CreateAttachmentInput {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  storageUrl: string;
  uploadedBy?: string;
}

// ─── Service factory ─────────────────────────────────────────────────────────

export function createIssueAttachmentService(db: Database) {
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
    /** List all attachments for an issue, newest first. */
    async list(issueId: string): Promise<IssueAttachmentSelect[]> {
      return db
        .select()
        .from(issueAttachment)
        .where(eq(issueAttachment.issueId, issueId))
        .orderBy(desc(issueAttachment.createdAt));
    },

    /** Create a new attachment and record an event. */
    async create(
      issueId: string,
      input: CreateAttachmentInput,
    ): Promise<IssueAttachmentSelect> {
      const [created] = await db
        .insert(issueAttachment)
        .values({
          issueId,
          fileName: input.fileName,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          storageUrl: input.storageUrl,
          uploadedBy: input.uploadedBy,
        })
        .returning();

      await recordEvent(
        issueId,
        input.uploadedBy ?? 'system',
        'attachment_added',
        {
          attachment_id: created.id,
          file_name: input.fileName,
          uploaded_by: input.uploadedBy ?? 'system',
        },
      );

      return created;
    },

    /** Hard-delete an attachment and record an event. */
    async delete(attachmentId: string, issueId: string): Promise<void> {
      const [row] = await db
        .select()
        .from(issueAttachment)
        .where(eq(issueAttachment.id, attachmentId));

      if (!row) {
        throw new Error(`Attachment ${attachmentId} not found.`);
      }

      await db
        .delete(issueAttachment)
        .where(eq(issueAttachment.id, attachmentId));

      await recordEvent(issueId, 'system', 'attachment_removed', {
        attachment_id: attachmentId,
        file_name: row.fileName,
      });
    },
  };
}

export type IssueAttachmentService = ReturnType<typeof createIssueAttachmentService>;
