import { z } from 'zod';
import {
  createIssue,
  getIssue,
  listIssues,
  transitionIssue,
  updateIssue,
} from '@/core/issues';
import { publicProcedure, router } from '@/server/trpc';

const issueStateEnum = z.enum(['open', 'in_progress', 'blocked', 'closed']);
const issuePriorityEnum = z.enum(['low', 'medium', 'high', 'critical']);
const issueTypeEnum = z.enum(['task', 'bug', 'feature', 'research']);

export const issueRouter = router({
  create: publicProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        title: z.string().min(1),
        description: z.string().optional(),
        priority: issuePriorityEnum.optional(),
        type: issueTypeEnum.optional(),
      })
    )
    .mutation(({ input }) => createIssue(input)),

  list: publicProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        state: issueStateEnum.optional(),
        type: issueTypeEnum.optional(),
      })
    )
    .query(({ input }) =>
      listIssues(input.projectId, {
        state: input.state,
        type: input.type,
      })
    ),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getIssue(input.id)),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        priority: issuePriorityEnum.optional(),
        type: issueTypeEnum.optional(),
      })
    )
    .mutation(({ input }) => {
      const { id, ...updates } = input;
      return updateIssue(id, updates);
    }),

  transition: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        state: issueStateEnum,
      })
    )
    .mutation(({ input }) => transitionIssue(input.id, input.state)),
});
