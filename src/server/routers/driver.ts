import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import { NotFoundError } from '@/core/errors/domain';
import { Feature } from '@/core/features/features';
import { DELETE_ROLES, EDIT_ROLES, REVERT_ROLES } from '@/core/features/roles';
import { createDriverService } from '@/core/services/driver';
import {
  featureGated,
  inputId,
  protectedMutation,
  publicProcedure,
  router,
} from '../trpc';

export const driverRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return createDriverService(ctx.db).list();
  }),

  getBySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const row = await createDriverService(ctx.db).getBySlug(input.slug);
      if (!row)
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Driver not found: ${input.slug}`,
        });
      return row;
    }),

  getById: publicProcedure.input(inputId()).query(async ({ ctx, input }) => {
    const row = await createDriverService(ctx.db).getById(input.id);
    if (!row)
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Driver not found: ${input.id}`,
      });
    return row;
  }),

  create: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        name: z.string().min(1),
        slug: z.string().min(1),
        binary: z.string().min(1),
        defaultArgs: z.array(z.string()).optional(),
        modelFlag: z.string().optional(),
        dirFlag: z.string().optional(),
        sessionNameFlag: z.string().optional(),
        promptTransport: z.string().optional(),
        outputFormat: z.string().optional(),
        outputFormatFlag: z.string().optional(),
        promptSendDelayMs: z.number().int().optional(),
        probeCommand: z.string().optional(),
        issuePromptTemplate: z.string().optional(),
        queuePromptTemplate: z.string().optional(),
        envVars: z.record(z.string(), z.string()).optional(),
        extraArgs: z.record(z.string(), z.unknown()).optional(),
        contextLayout: z.unknown().optional(),
        isEnabled: z.boolean().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createDriverService(ctx.db).create(input);
    }),

  update: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        name: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        binary: z.string().min(1).optional(),
        defaultArgs: z.array(z.string()).optional(),
        modelFlag: z.string().nullable().optional(),
        dirFlag: z.string().nullable().optional(),
        sessionNameFlag: z.string().nullable().optional(),
        promptTransport: z.string().optional(),
        outputFormat: z.string().optional(),
        outputFormatFlag: z.string().nullable().optional(),
        promptSendDelayMs: z.number().int().optional(),
        probeCommand: z.string().nullable().optional(),
        issuePromptTemplate: z.string().nullable().optional(),
        queuePromptTemplate: z.string().nullable().optional(),
        envVars: z.record(z.string(), z.string()).optional(),
        extraArgs: z.record(z.string(), z.unknown()).optional(),
        contextLayout: z.unknown().optional(),
        isEnabled: z.boolean().optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      return createDriverService(ctx.db).update(id, version, data);
    }),

  // FLX-91: list revisions for a driver, newest first.
  // FLX-14: revision history is a paid-tier feature.
  listHistory: featureGated(Feature.REVISION_HISTORY)
    .input(inputId())
    .query(async ({ ctx, input }) => {
      return createDriverService(ctx.db).listHistory(input.id);
    }),

  // FLX-91: revert a driver to a snapshotted revision. Writes a NEW
  // revision capturing the reverted state (history is append-only).
  revertToRevision: protectedMutation(REVERT_ROLES)
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        revisionNumber: z.number().int().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createDriverService(ctx.db).revertToRevision(
        input.id,
        input.version,
        input.revisionNumber
      );
    }),

  delete: protectedMutation(DELETE_ROLES)
    .input(z.object({ id: z.string().uuid(), version: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await createDriverService(ctx.db).delete(input.id, input.version);
      } catch (err) {
        if (err instanceof NotFoundError) {
          throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
        }
        throw err;
      }
    }),
});
