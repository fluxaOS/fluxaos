import { z } from 'zod/v4';
import { router, publicProcedure } from '../trpc';
import { createIssueService } from '@/core/services';

const issueState = z.enum(['open', 'in_progress', 'blocked', 'closed']);
const issuePriority = z.enum(['low', 'medium', 'high', 'critical']);
const issueType = z.enum(['task', 'bug', 'feature', 'research']);

export const issueRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return createIssueService(ctx.db).list();
  }),

  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createIssueService(ctx.db).listByProject(input.projectId);
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createIssueService(ctx.db).getById(input.id);
    }),

  create: publicProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      title: z.string().min(1),
      description: z.string().optional(),
      state: issueState.optional(),
      priority: issuePriority.optional(),
      type: issueType.optional(),
      createdBy: z.string().optional(),
      source: z.string().optional(),
    }))
    .mutation(({ ctx, input }) => {
      return createIssueService(ctx.db).create(input);
    }),

  updateFields: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      priority: issuePriority.optional(),
      type: issueType.optional(),
      userId: z.string().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const { id, userId, ...fields } = input;
      return createIssueService(ctx.db).updateFields(id, fields, userId);
    }),

  transition: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      state: issueState,
      userId: z.string().optional(),
    }))
    .mutation(({ ctx, input }) => {
      return createIssueService(ctx.db).transition(input.id, input.state, input.userId);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      return createIssueService(ctx.db).remove(input.id);
    }),

  // Comments
  addComment: publicProcedure
    .input(z.object({
      issueId: z.string().uuid(),
      text: z.string().min(1),
      author: z.string().min(1),
    }))
    .mutation(({ ctx, input }) => {
      return createIssueService(ctx.db).addComment(input.issueId, {
        text: input.text,
        author: input.author,
      });
    }),

  updateComment: publicProcedure
    .input(z.object({
      eventId: z.string().uuid(),
      text: z.string().min(1),
      editedBy: z.string().min(1),
    }))
    .mutation(({ ctx, input }) => {
      return createIssueService(ctx.db).updateComment(input.eventId, {
        text: input.text,
        editedBy: input.editedBy,
      });
    }),

  deleteComment: publicProcedure
    .input(z.object({ eventId: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      return createIssueService(ctx.db).deleteComment(input.eventId);
    }),

  listEvents: publicProcedure
    .input(z.object({ issueId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createIssueService(ctx.db).listEvents(input.issueId);
    }),
});
