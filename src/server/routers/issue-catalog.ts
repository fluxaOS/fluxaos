/**
 * Issue catalog router — CRUD for types, states, statuses, priorities, labels,
 * transitions, and a health check endpoint.
 *
 * Each catalog type has: list (active), listAll (including inactive), create,
 * update, deactivate. Transitions have list, create, delete (hard).
 * Health verifies all required catalogs and config entries exist.
 */
import { z } from 'zod/v4';
import { CONFIG_KEY } from '@/core/constants';
import { DELETE_ROLES, EDIT_ROLES } from '@/core/features/roles';
import { createIssueCatalogService } from '@/core/services';
import { inputId, protectedMutation, publicProcedure, router } from '../trpc';

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

// ─── Router ──────────────────────────────────────────────────────────────────

export const issueCatalogRouter = router({
  // ─── Types ─────────────────────────────────────────────────────────────────
  types: router({
    list: publicProcedure
      .input(projectIdInput)
      .query(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).types.list(input.projectId)
      ),
    listAll: publicProcedure
      .input(projectIdInput)
      .query(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).types.listAll(input.projectId)
      ),
    create: protectedMutation(EDIT_ROLES)
      .input(typeInput)
      .mutation(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).types.create(input)
      ),
    update: protectedMutation(EDIT_ROLES)
      .input(inputId().merge(typeInput.partial()))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return createIssueCatalogService(ctx.db).types.update(id, data);
      }),
    deactivate: protectedMutation(EDIT_ROLES)
      .input(inputId())
      .mutation(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).types.deactivate(input.id)
      ),
  }),

  // ─── States ────────────────────────────────────────────────────────────────
  states: router({
    list: publicProcedure
      .input(projectIdInput)
      .query(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).states.list(input.projectId)
      ),
    listAll: publicProcedure
      .input(projectIdInput)
      .query(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).states.listAll(input.projectId)
      ),
    create: protectedMutation(EDIT_ROLES)
      .input(stateInput)
      .mutation(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).states.create(input)
      ),
    update: protectedMutation(EDIT_ROLES)
      .input(inputId().merge(stateInput.partial()))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return createIssueCatalogService(ctx.db).states.update(id, data);
      }),
    deactivate: protectedMutation(EDIT_ROLES)
      .input(inputId())
      .mutation(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).states.deactivate(input.id)
      ),
  }),

  // ─── Statuses ──────────────────────────────────────────────────────────────
  statuses: router({
    list: publicProcedure
      .input(projectIdInput)
      .query(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).statuses.list(input.projectId)
      ),
    listAll: publicProcedure
      .input(projectIdInput)
      .query(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).statuses.listAll(input.projectId)
      ),
    create: protectedMutation(EDIT_ROLES)
      .input(statusInput)
      .mutation(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).statuses.create(input)
      ),
    update: protectedMutation(EDIT_ROLES)
      .input(inputId().merge(statusInput.partial()))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return createIssueCatalogService(ctx.db).statuses.update(id, data);
      }),
    deactivate: protectedMutation(EDIT_ROLES)
      .input(inputId())
      .mutation(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).statuses.deactivate(input.id)
      ),
  }),

  // ─── Priorities ────────────────────────────────────────────────────────────
  priorities: router({
    list: publicProcedure
      .input(projectIdInput)
      .query(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).priorities.list(input.projectId)
      ),
    listAll: publicProcedure
      .input(projectIdInput)
      .query(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).priorities.listAll(input.projectId)
      ),
    create: protectedMutation(EDIT_ROLES)
      .input(priorityInput)
      .mutation(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).priorities.create(input)
      ),
    update: protectedMutation(EDIT_ROLES)
      .input(inputId().merge(priorityInput.partial()))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return createIssueCatalogService(ctx.db).priorities.update(id, data);
      }),
    deactivate: protectedMutation(EDIT_ROLES)
      .input(inputId())
      .mutation(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).priorities.deactivate(input.id)
      ),
  }),

  // ─── Labels ────────────────────────────────────────────────────────────────
  labels: router({
    list: publicProcedure
      .input(projectIdInput)
      .query(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).labels.list(input.projectId)
      ),
    listAll: publicProcedure
      .input(projectIdInput)
      .query(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).labels.listAll(input.projectId)
      ),
    create: protectedMutation(EDIT_ROLES)
      .input(labelInput)
      .mutation(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).labels.create(input)
      ),
    update: protectedMutation(EDIT_ROLES)
      .input(inputId().merge(labelInput.partial()))
      .mutation(({ ctx, input }) => {
        const { id, ...data } = input;
        return createIssueCatalogService(ctx.db).labels.update(id, data);
      }),
    deactivate: protectedMutation(EDIT_ROLES)
      .input(inputId())
      .mutation(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).labels.deactivate(input.id)
      ),
  }),

  // ─── Transitions ───────────────────────────────────────────────────────────
  transitions: router({
    list: publicProcedure
      .input(projectIdInput)
      .query(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).transitions.list(input.projectId)
      ),
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
      .mutation(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).transitions.create(input)
      ),
    delete: protectedMutation(DELETE_ROLES)
      .input(inputId())
      .mutation(({ ctx, input }) =>
        createIssueCatalogService(ctx.db).transitions.delete(input.id)
      ),
  }),

  // ─── Health check ──────────────────────────────────────────────────────────
  health: publicProcedure
    .input(projectIdInput)
    .query(async ({ ctx, input }) => {
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
