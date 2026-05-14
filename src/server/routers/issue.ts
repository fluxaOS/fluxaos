/**
 * Issue router — nested sub-routers for the full issue domain.
 *
 * Structure: issue.list, issue.comment.list, issue.event.list, etc.
 * All IDs are UUIDs. No hardcoded enums. Version required on all mutations
 * that modify existing data. Routers are thin — logic lives in services.
 */
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import type { Database } from '@/core/db/connection';
import { issue, issueComment } from '@/core/db/schema';
import { DELETE_ROLES, EDIT_ROLES } from '@/core/features/roles';
import {
  createIssueCommentService,
  createIssueEventService,
  createIssueService,
} from '@/core/services';
import { assertProjectOwnership } from '../ownership';
import type { Viewer } from '../trpc';
import { inputId, protectedMutation, publicProcedure, router } from '../trpc';

/**
 * Resolve the projectId for a given issue. Returns null if the issue does not
 * exist.
 */
async function getProjectIdForIssue(
  db: Database,
  issueId: string
): Promise<string | null> {
  const [row] = await db
    .select({ projectId: issue.projectId })
    .from(issue)
    .where(eq(issue.id, issueId));
  return row?.projectId ?? null;
}

/**
 * Resolve the projectId for a given comment (via its parent issue). Returns
 * null if the comment does not exist.
 */
async function getProjectIdForComment(
  db: Database,
  commentId: string
): Promise<string | null> {
  const [commentRow] = await db
    .select({ issueId: issueComment.issueId })
    .from(issueComment)
    .where(eq(issueComment.id, commentId));
  if (!commentRow) return null;
  return getProjectIdForIssue(db, commentRow.issueId);
}

/**
 * Assert that the viewer is allowed to access resources in the given project.
 * Throws NOT_FOUND (not FORBIDDEN) to avoid leaking project existence to
 * unauthorized callers. Authenticated viewers must own the project; anonymous
 * viewers (fluxaUserId === null) are allowed through (LAN auth bypass).
 */
async function assertProjectViewership(
  db: Database,
  projectId: string,
  viewer: Viewer
): Promise<void> {
  await assertProjectOwnership(db, projectId, viewer.fluxaUserId);
}

export const issueRouter = router({
  // ─── Core issue operations ──────────────────────────────────────────────────

  list: publicProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        isClosed: z.boolean().optional(),
        typeId: z.string().uuid().optional(),
        stateId: z.string().uuid().optional(),
        priorityId: z.string().uuid().optional(),
        assignee: z.string().optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertProjectViewership(ctx.db, input.projectId, ctx.viewer);
      const { projectId, ...filters } = input;
      return createIssueService(ctx.db).listByProject(projectId, filters);
    }),

  getByNumber: publicProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        number: z.number().int().positive(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertProjectViewership(ctx.db, input.projectId, ctx.viewer);
      return createIssueService(ctx.db).getByNumber(
        input.projectId,
        input.number
      );
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid(), projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectViewership(ctx.db, input.projectId, ctx.viewer);

      const result = await createIssueService(ctx.db).getById(
        input.id,
        input.projectId
      );
      if (!result) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      return result;
    }),

  create: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        projectId: z.string().uuid(),
        title: z.string().min(1),
        bodyMd: z.string().optional(),
        typeId: z.string().uuid(),
        priorityId: z.string().uuid(),
        assignee: z.string().optional(),
        labels: z.array(z.string()).optional(),
        author: z.string().optional(),
        parentIssueId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectViewership(ctx.db, input.projectId, ctx.viewer);
      return createIssueService(ctx.db).create(input);
    }),

  // ─── Parent-child relationships (R-EPIC) ────────────────────────────────────

  getChildren: publicProcedure
    .input(z.object({ parentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const projectId = await getProjectIdForIssue(ctx.db, input.parentId);
      if (projectId) {
        await assertProjectViewership(ctx.db, projectId, ctx.viewer);
      }
      return createIssueService(ctx.db).getChildren(input.parentId);
    }),

  hasOpenChildren: publicProcedure
    .input(inputId())
    .query(async ({ ctx, input }) => {
      const projectId = await getProjectIdForIssue(ctx.db, input.id);
      if (projectId) {
        await assertProjectViewership(ctx.db, projectId, ctx.viewer);
      }
      return createIssueService(ctx.db).hasOpenChildren(input.id);
    }),

  openChildCountsByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectViewership(ctx.db, input.projectId, ctx.viewer);
      const map = await createIssueService(ctx.db).openChildCountsByProject(
        input.projectId
      );
      return Object.fromEntries(map);
    }),

  updateFields: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        id: z.string().uuid(),
        projectId: z.string().uuid(),
        version: z.number().int(),
        title: z.string().min(1).optional(),
        bodyMd: z.string().optional(),
        typeId: z.string().uuid().optional(),
        priorityId: z.string().uuid().optional(),
        assignee: z.string().nullable().optional(),
        labels: z.array(z.string()).optional(),
        userId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectViewership(ctx.db, input.projectId, ctx.viewer);

      const { id, projectId, version, userId, ...fields } = input;
      return createIssueService(ctx.db).updateFields(
        id,
        fields,
        version,
        projectId,
        userId
      );
    }),

  transition: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        id: z.string().uuid(),
        projectId: z.string().uuid(),
        toStateId: z.string().uuid(),
        version: z.number().int(),
        userId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectViewership(ctx.db, input.projectId, ctx.viewer);

      return createIssueService(ctx.db).transition(
        input.id,
        input.toStateId,
        input.version,
        input.projectId,
        input.userId
      );
    }),

  delete: protectedMutation(DELETE_ROLES)
    .input(z.object({ id: z.string().uuid(), projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectViewership(ctx.db, input.projectId, ctx.viewer);

      return createIssueService(ctx.db).delete(input.id, input.projectId);
    }),

  transitions: publicProcedure
    .input(inputId())
    .query(async ({ ctx, input }) => {
      const projectId = await getProjectIdForIssue(ctx.db, input.id);
      if (projectId) {
        await assertProjectViewership(ctx.db, projectId, ctx.viewer);
      }
      return createIssueService(ctx.db).getValidTransitions(input.id);
    }),

  // ─── Comment sub-router ─────────────────────────────────────────────────────

  comment: router({
    list: publicProcedure
      .input(z.object({ issueId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const projectId = await getProjectIdForIssue(ctx.db, input.issueId);
        if (projectId) {
          await assertProjectViewership(ctx.db, projectId, ctx.viewer);
        }
        return createIssueCommentService(ctx.db).list(input.issueId);
      }),

    create: protectedMutation(EDIT_ROLES)
      .input(
        z.object({
          issueId: z.string().uuid(),
          bodyMd: z.string().min(1),
          author: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const projectId = await getProjectIdForIssue(ctx.db, input.issueId);
        if (projectId) {
          await assertProjectViewership(ctx.db, projectId, ctx.viewer);
        }
        return createIssueCommentService(ctx.db).create(input.issueId, {
          bodyMd: input.bodyMd,
          author: input.author,
        });
      }),

    update: protectedMutation(EDIT_ROLES)
      .input(
        z.object({
          commentId: z.string().uuid(),
          bodyMd: z.string().min(1),
          editedBy: z.string().min(1),
          version: z.number().int(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const projectId = await getProjectIdForComment(ctx.db, input.commentId);
        if (projectId) {
          await assertProjectViewership(ctx.db, projectId, ctx.viewer);
        }
        return createIssueCommentService(ctx.db).update(input.commentId, {
          bodyMd: input.bodyMd,
          editedBy: input.editedBy,
          version: input.version,
        });
      }),

    delete: protectedMutation(DELETE_ROLES)
      .input(
        z.object({
          commentId: z.string().uuid(),
          deletedBy: z.string().min(1),
          version: z.number().int(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const projectId = await getProjectIdForComment(ctx.db, input.commentId);
        if (projectId) {
          await assertProjectViewership(ctx.db, projectId, ctx.viewer);
        }
        return createIssueCommentService(ctx.db).softDelete(input.commentId, {
          deletedBy: input.deletedBy,
          version: input.version,
        });
      }),
  }),

  // ─── Event sub-router ───────────────────────────────────────────────────────

  event: router({
    list: publicProcedure
      .input(
        z.object({
          issueId: z.string().uuid(),
          filter: z.enum(['all', 'comments', 'state', 'pipeline']).optional(),
        })
      )
      .query(({ ctx, input }) =>
        createIssueEventService(ctx.db).list(input.issueId, input.filter)
      ),
  }),
});
