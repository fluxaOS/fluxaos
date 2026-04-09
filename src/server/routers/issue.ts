/**
 * Issue router — nested sub-routers for the full issue domain.
 *
 * Structure: issue.list, issue.comment.list, issue.attachment.create, etc.
 * All IDs are UUIDs. No hardcoded enums. Version required on all mutations
 * that modify existing data. Routers are thin — logic lives in services.
 */
import { z } from 'zod/v4';
import { router, publicProcedure } from '../trpc';
import {
  createIssueService,
  createIssueCommentService,
  createIssueAttachmentService,
  createIssueDependencyService,
  createIssueEventService,
  createIssueSavedViewService,
} from '@/core/services';

export const issueRouter = router({
  // ─── Core issue operations ──────────────────────────────────────────────────

  list: publicProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      isClosed: z.boolean().optional(),
      typeId: z.string().uuid().optional(),
      stateId: z.string().uuid().optional(),
      priorityId: z.string().uuid().optional(),
      assignee: z.string().optional(),
      search: z.string().optional(),
    }))
    .query(({ ctx, input }) => {
      const { projectId, ...filters } = input;
      return createIssueService(ctx.db).listByProject(projectId, filters);
    }),

  getByNumber: publicProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      number: z.number().int().positive(),
    }))
    .query(({ ctx, input }) =>
      createIssueService(ctx.db).getByNumber(input.projectId, input.number)),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => createIssueService(ctx.db).getById(input.id)),

  create: publicProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      title: z.string().min(1),
      bodyMd: z.string().optional(),
      typeId: z.string().uuid(),
      priorityId: z.string().uuid(),
      assignee: z.string().optional(),
      labels: z.array(z.string()).optional(),
      author: z.string().optional(),
    }))
    .mutation(({ ctx, input }) => createIssueService(ctx.db).create(input)),

  updateFields: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      version: z.number().int(),
      title: z.string().min(1).optional(),
      bodyMd: z.string().optional(),
      typeId: z.string().uuid().optional(),
      priorityId: z.string().uuid().optional(),
      assignee: z.string().nullable().optional(),
      labels: z.array(z.string()).optional(),
      userId: z.string().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const { id, version, userId, ...fields } = input;
      return createIssueService(ctx.db).updateFields(id, fields, version, userId);
    }),

  transition: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      toStateId: z.string().uuid(),
      version: z.number().int(),
      userId: z.string().optional(),
    }))
    .mutation(({ ctx, input }) =>
      createIssueService(ctx.db).transition(input.id, input.toStateId, input.version, input.userId)),

  stateOverride: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      toStateId: z.string().uuid(),
      version: z.number().int(),
      userId: z.string().optional(),
    }))
    .mutation(({ ctx, input }) =>
      createIssueService(ctx.db).stateOverride(input.id, input.toStateId, input.version, input.userId)),

  close: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      version: z.number().int(),
      userId: z.string().optional(),
    }))
    .mutation(({ ctx, input }) =>
      createIssueService(ctx.db).close(input.id, input.version, input.userId)),

  reopen: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      version: z.number().int(),
      userId: z.string().optional(),
    }))
    .mutation(({ ctx, input }) =>
      createIssueService(ctx.db).reopen(input.id, input.version, input.userId)),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => createIssueService(ctx.db).delete(input.id)),

  transitions: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => createIssueService(ctx.db).getValidTransitions(input.id)),

  users: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { sql } = await import('drizzle-orm');
      const rows = await ctx.db.execute(
        sql`SELECT DISTINCT val FROM (
          SELECT assignee AS val FROM issue WHERE project_id = ${input.projectId} AND assignee IS NOT NULL
          UNION
          SELECT author AS val FROM issue WHERE project_id = ${input.projectId}
        ) AS users ORDER BY val`
      );
      return (rows as unknown as Array<{ val: string }>).map(r => r.val);
    }),

  // ─── Comment sub-router ─────────────────────────────────────────────────────

  comment: router({
    list: publicProcedure
      .input(z.object({ issueId: z.string().uuid() }))
      .query(({ ctx, input }) =>
        createIssueCommentService(ctx.db).list(input.issueId)),

    create: publicProcedure
      .input(z.object({
        issueId: z.string().uuid(),
        bodyMd: z.string().min(1),
        author: z.string().min(1),
      }))
      .mutation(({ ctx, input }) =>
        createIssueCommentService(ctx.db).create(input.issueId, {
          bodyMd: input.bodyMd,
          author: input.author,
        })),

    update: publicProcedure
      .input(z.object({
        commentId: z.string().uuid(),
        bodyMd: z.string().min(1),
        editedBy: z.string().min(1),
        version: z.number().int(),
      }))
      .mutation(({ ctx, input }) =>
        createIssueCommentService(ctx.db).update(input.commentId, {
          bodyMd: input.bodyMd,
          editedBy: input.editedBy,
          version: input.version,
        })),

    delete: publicProcedure
      .input(z.object({
        commentId: z.string().uuid(),
        deletedBy: z.string().min(1),
        version: z.number().int(),
      }))
      .mutation(({ ctx, input }) =>
        createIssueCommentService(ctx.db).softDelete(input.commentId, {
          deletedBy: input.deletedBy,
          version: input.version,
        })),
  }),

  // ─── Attachment sub-router ──────────────────────────────────────────────────

  attachment: router({
    list: publicProcedure
      .input(z.object({ issueId: z.string().uuid() }))
      .query(({ ctx, input }) =>
        createIssueAttachmentService(ctx.db).list(input.issueId)),

    create: publicProcedure
      .input(z.object({
        issueId: z.string().uuid(),
        fileName: z.string().min(1),
        contentType: z.string().min(1),
        sizeBytes: z.number().int().positive(),
        storageUrl: z.string().url(),
        uploadedBy: z.string().optional(),
      }))
      .mutation(({ ctx, input }) =>
        createIssueAttachmentService(ctx.db).create(input.issueId, {
          fileName: input.fileName,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          storageUrl: input.storageUrl,
          uploadedBy: input.uploadedBy,
        })),

    delete: publicProcedure
      .input(z.object({
        attachmentId: z.string().uuid(),
        issueId: z.string().uuid(),
      }))
      .mutation(({ ctx, input }) =>
        createIssueAttachmentService(ctx.db).delete(input.attachmentId, input.issueId)),
  }),

  // ─── Dependency sub-router ──────────────────────────────────────────────────

  dependency: router({
    list: publicProcedure
      .input(z.object({ issueId: z.string().uuid() }))
      .query(({ ctx, input }) =>
        createIssueDependencyService(ctx.db).list(input.issueId)),

    create: publicProcedure
      .input(z.object({
        projectId: z.string().uuid(),
        issueId: z.string().uuid(),
        dependsOnIssueId: z.string().uuid(),
        dependencyType: z.string().optional(),
      }))
      .mutation(({ ctx, input }) =>
        createIssueDependencyService(ctx.db).create(
          input.projectId,
          input.issueId,
          input.dependsOnIssueId,
          input.dependencyType,
        )),

    delete: publicProcedure
      .input(z.object({
        dependencyId: z.string().uuid(),
        issueId: z.string().uuid(),
      }))
      .mutation(({ ctx, input }) =>
        createIssueDependencyService(ctx.db).delete(input.dependencyId, input.issueId)),
  }),

  // ─── Event sub-router ───────────────────────────────────────────────────────

  event: router({
    list: publicProcedure
      .input(z.object({
        issueId: z.string().uuid(),
        filter: z.enum(['all', 'comments', 'state', 'pipeline']).optional(),
      }))
      .query(({ ctx, input }) =>
        createIssueEventService(ctx.db).list(input.issueId, input.filter)),
  }),

  // ─── Saved view sub-router ──────────────────────────────────────────────────

  savedView: router({
    list: publicProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .query(({ ctx, input }) =>
        createIssueSavedViewService(ctx.db).list(input.projectId)),

    create: publicProcedure
      .input(z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1),
        filters: z.unknown(),
        sortField: z.string().optional(),
        sortOrder: z.string().optional(),
        limit: z.number().int().positive().optional(),
        isDefault: z.boolean().optional(),
        createdBy: z.string().optional(),
      }))
      .mutation(({ ctx, input }) =>
        createIssueSavedViewService(ctx.db).create(input.projectId, {
          name: input.name,
          filters: input.filters,
          sortField: input.sortField,
          sortOrder: input.sortOrder,
          limit: input.limit,
          isDefault: input.isDefault,
          createdBy: input.createdBy,
        })),

    update: publicProcedure
      .input(z.object({
        viewId: z.string().uuid(),
        name: z.string().min(1).optional(),
        filters: z.unknown().optional(),
        sortField: z.string().nullable().optional(),
        sortOrder: z.string().nullable().optional(),
        limit: z.number().int().positive().nullable().optional(),
        isDefault: z.boolean().optional(),
      }))
      .mutation(({ ctx, input }) => {
        const { viewId, ...fields } = input;
        return createIssueSavedViewService(ctx.db).update(viewId, fields);
      }),

    delete: publicProcedure
      .input(z.object({ viewId: z.string().uuid() }))
      .mutation(({ ctx, input }) =>
        createIssueSavedViewService(ctx.db).delete(input.viewId)),

    setDefault: publicProcedure
      .input(z.object({
        projectId: z.string().uuid(),
        viewId: z.string().uuid(),
      }))
      .mutation(({ ctx, input }) =>
        createIssueSavedViewService(ctx.db).setDefault(input.projectId, input.viewId)),
  }),
});
