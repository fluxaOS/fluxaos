/**
 * Issue catalog router — CRUD for types, states, statuses, priorities, labels,
 * transitions, and a health check endpoint.
 *
 * Each catalog type has: list (active), create, update, deactivate.
 * Transitions have list, create, delete (hard).
 * Health verifies all required catalogs and config entries exist.
 */
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { CONFIG_KEY } from '@/core/constants';
import { issueTransition } from '@/core/db/schema';
import { DELETE_ROLES, EDIT_ROLES } from '@/core/features/roles';
import { createIssueCatalogService } from '@/core/services';
import { assertProjectAccess } from '../ownership';
import {
  inputId,
  protectedMutation,
  publicProcedure,
  router,
  type TRPCContext,
} from '../trpc';

// ─── Reusable input schemas ──────────────────────────────────────────────────

const projectIdInput = z.object({ projectId: z.string().uuid() });

const typeInput = z.object({
  projectId: z.string().uuid(),
  key: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  color: z.string().min(1),
  sortOrder: z.number().int(),
});

const stateInput = z.object({
  projectId: z.string().uuid(),
  key: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  color: z.string().min(1),
  isTerminal: z.boolean(),
  sortOrder: z.number().int(),
});

const statusInput = z.object({
  projectId: z.string().uuid(),
  key: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  sortOrder: z.number().int(),
});

const priorityInput = z.object({
  projectId: z.string().uuid(),
  key: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  color: z.string().min(1),
  weight: z.number().int(),
});

const labelInput = z.object({
  projectId: z.string().uuid(),
  key: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  color: z.string().min(1),
  sortOrder: z.number().int(),
});

async function assertIssueCatalogAccess(
  ctx: TRPCContext,
  projectId: string
) {
  await assertProjectAccess(ctx.db, projectId, ctx.viewer.fluxaUserId, {
    notOwnedCode: 'FORBIDDEN',
    notOwnedMsg: 'You do not have access to this project.',
  });
}

async function assertCatalogRowAccess(
  ctx: TRPCContext,
  row: { projectId: string | null } | null,
  id: string
) {
  if (!row || !row.projectId) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Issue catalog row not found: ${id}`,
    });
  }
  await assertIssueCatalogAccess(ctx, row.projectId);
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const issueCatalogRouter = router({
  // ─── Types ─────────────────────────────────────────────────────────────────
  types: router({
    list: publicProcedure
      .input(projectIdInput)
      .query(async ({ ctx, input }) => {
        await assertIssueCatalogAccess(ctx, input.projectId);
        return createIssueCatalogService(ctx.db).types.list(input.projectId);
      }),
    create: protectedMutation(EDIT_ROLES)
      .input(typeInput)
      .mutation(async ({ ctx, input }) => {
        await assertIssueCatalogAccess(ctx, input.projectId);
        return createIssueCatalogService(ctx.db).types.create(input);
      }),
    update: protectedMutation(EDIT_ROLES)
      .input(inputId().merge(typeInput.partial()))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const svc = createIssueCatalogService(ctx.db);
        const existing = await svc.types.getById(id);
        await assertCatalogRowAccess(ctx, existing, id);
        return svc.types.update(id, data);
      }),
    deactivate: protectedMutation(EDIT_ROLES)
      .input(inputId())
      .mutation(async ({ ctx, input }) => {
        const svc = createIssueCatalogService(ctx.db);
        const existing = await svc.types.getById(input.id);
        await assertCatalogRowAccess(ctx, existing, input.id);
        return svc.types.deactivate(input.id);
      }),
  }),

  // ─── States ────────────────────────────────────────────────────────────────
  states: router({
    list: publicProcedure
      .input(projectIdInput)
      .query(async ({ ctx, input }) => {
        await assertIssueCatalogAccess(ctx, input.projectId);
        return createIssueCatalogService(ctx.db).states.list(input.projectId);
      }),
    create: protectedMutation(EDIT_ROLES)
      .input(stateInput)
      .mutation(async ({ ctx, input }) => {
        await assertIssueCatalogAccess(ctx, input.projectId);
        return createIssueCatalogService(ctx.db).states.create(input);
      }),
    update: protectedMutation(EDIT_ROLES)
      .input(inputId().merge(stateInput.partial()))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const svc = createIssueCatalogService(ctx.db);
        const existing = await svc.states.getById(id);
        await assertCatalogRowAccess(ctx, existing, id);
        return svc.states.update(id, data);
      }),
    deactivate: protectedMutation(EDIT_ROLES)
      .input(inputId())
      .mutation(async ({ ctx, input }) => {
        const svc = createIssueCatalogService(ctx.db);
        const existing = await svc.states.getById(input.id);
        await assertCatalogRowAccess(ctx, existing, input.id);
        return svc.states.deactivate(input.id);
      }),
  }),

  // ─── Statuses ──────────────────────────────────────────────────────────────
  statuses: router({
    list: publicProcedure
      .input(projectIdInput)
      .query(async ({ ctx, input }) => {
        await assertIssueCatalogAccess(ctx, input.projectId);
        return createIssueCatalogService(ctx.db).statuses.list(input.projectId);
      }),
    create: protectedMutation(EDIT_ROLES)
      .input(statusInput)
      .mutation(async ({ ctx, input }) => {
        await assertIssueCatalogAccess(ctx, input.projectId);
        return createIssueCatalogService(ctx.db).statuses.create(input);
      }),
    update: protectedMutation(EDIT_ROLES)
      .input(inputId().merge(statusInput.partial()))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const svc = createIssueCatalogService(ctx.db);
        const existing = await svc.statuses.getById(id);
        await assertCatalogRowAccess(ctx, existing, id);
        return svc.statuses.update(id, data);
      }),
    deactivate: protectedMutation(EDIT_ROLES)
      .input(inputId())
      .mutation(async ({ ctx, input }) => {
        const svc = createIssueCatalogService(ctx.db);
        const existing = await svc.statuses.getById(input.id);
        await assertCatalogRowAccess(ctx, existing, input.id);
        return svc.statuses.deactivate(input.id);
      }),
  }),

  // ─── Priorities ────────────────────────────────────────────────────────────
  priorities: router({
    list: publicProcedure
      .input(projectIdInput)
      .query(async ({ ctx, input }) => {
        await assertIssueCatalogAccess(ctx, input.projectId);
        return createIssueCatalogService(ctx.db).priorities.list(
          input.projectId
        );
      }),
    create: protectedMutation(EDIT_ROLES)
      .input(priorityInput)
      .mutation(async ({ ctx, input }) => {
        await assertIssueCatalogAccess(ctx, input.projectId);
        return createIssueCatalogService(ctx.db).priorities.create(input);
      }),
    update: protectedMutation(EDIT_ROLES)
      .input(inputId().merge(priorityInput.partial()))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const svc = createIssueCatalogService(ctx.db);
        const existing = await svc.priorities.getById(id);
        await assertCatalogRowAccess(ctx, existing, id);
        return svc.priorities.update(id, data);
      }),
    deactivate: protectedMutation(EDIT_ROLES)
      .input(inputId())
      .mutation(async ({ ctx, input }) => {
        const svc = createIssueCatalogService(ctx.db);
        const existing = await svc.priorities.getById(input.id);
        await assertCatalogRowAccess(ctx, existing, input.id);
        return svc.priorities.deactivate(input.id);
      }),
  }),

  // ─── Labels ────────────────────────────────────────────────────────────────
  labels: router({
    list: publicProcedure
      .input(projectIdInput)
      .query(async ({ ctx, input }) => {
        await assertIssueCatalogAccess(ctx, input.projectId);
        return createIssueCatalogService(ctx.db).labels.list(input.projectId);
      }),
    create: protectedMutation(EDIT_ROLES)
      .input(labelInput)
      .mutation(async ({ ctx, input }) => {
        await assertIssueCatalogAccess(ctx, input.projectId);
        return createIssueCatalogService(ctx.db).labels.create(input);
      }),
    update: protectedMutation(EDIT_ROLES)
      .input(inputId().merge(labelInput.partial()))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const svc = createIssueCatalogService(ctx.db);
        const existing = await svc.labels.getById(id);
        await assertCatalogRowAccess(ctx, existing, id);
        return svc.labels.update(id, data);
      }),
    deactivate: protectedMutation(EDIT_ROLES)
      .input(inputId())
      .mutation(async ({ ctx, input }) => {
        const svc = createIssueCatalogService(ctx.db);
        const existing = await svc.labels.getById(input.id);
        await assertCatalogRowAccess(ctx, existing, input.id);
        return svc.labels.deactivate(input.id);
      }),
  }),

  // ─── Transitions ───────────────────────────────────────────────────────────
  transitions: router({
    list: publicProcedure
      .input(projectIdInput)
      .query(async ({ ctx, input }) => {
        await assertIssueCatalogAccess(ctx, input.projectId);
        return createIssueCatalogService(ctx.db).transitions.list(
          input.projectId
        );
      }),
    create: protectedMutation(EDIT_ROLES)
      .input(
        z.object({
          projectId: z.string().uuid(),
          fromStateId: z.string().uuid(),
          toStateId: z.string().uuid(),
          description: z.string().optional(),
          sortOrder: z.number().int().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await assertIssueCatalogAccess(ctx, input.projectId);
        return createIssueCatalogService(ctx.db).transitions.create(input);
      }),
    delete: protectedMutation(DELETE_ROLES)
      .input(inputId())
      .mutation(async ({ ctx, input }) => {
        const [existing] = await ctx.db
          .select({ projectId: issueTransition.projectId })
          .from(issueTransition)
          .where(eq(issueTransition.id, input.id));
        await assertCatalogRowAccess(ctx, existing ?? null, input.id);
        return createIssueCatalogService(ctx.db).transitions.delete(input.id);
      }),
  }),

  // ─── Health check ──────────────────────────────────────────────────────────
  health: publicProcedure
    .input(projectIdInput)
    .query(async ({ ctx, input }) => {
      await assertIssueCatalogAccess(ctx, input.projectId);
      const svc = createIssueCatalogService(ctx.db);
      const missing: string[] = [];

      const [types, states, statuses, priorities] = await Promise.all([
        svc.types.list(input.projectId),
        svc.states.list(input.projectId),
        svc.statuses.list(input.projectId),
        svc.priorities.list(input.projectId),
      ]);

      if (types.length === 0) missing.push('issue_type');
      if (states.length === 0) missing.push('issue_state');
      if (statuses.length === 0) missing.push('issue_status');
      if (priorities.length === 0) missing.push('issue_priority');

      // Check config entries for status automation
      const { configEntry } = await import('@/core/db/schema');
      const { eq, and } = await import('drizzle-orm');
      const requiredKeys = [
        CONFIG_KEY.issueStatusOnCreate,
        CONFIG_KEY.issueStatusOnEnqueued,
        CONFIG_KEY.issueStatusOnRunning,
        CONFIG_KEY.issueStatusOnBlocked,
        CONFIG_KEY.issueStatusOnCompleted,
      ];
      for (const key of requiredKeys) {
        const [entry] = await ctx.db
          .select()
          .from(configEntry)
          .where(
            and(
              eq(configEntry.projectId, input.projectId),
              eq(configEntry.key, key)
            )
          );
        if (!entry) missing.push(`config:${key}`);
      }

      return { ready: missing.length === 0, missing };
    }),
});
