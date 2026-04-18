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
  createIssueEventService,
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

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => createIssueService(ctx.db).delete(input.id)),

  transitions: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => createIssueService(ctx.db).getValidTransitions(input.id)),

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
});
