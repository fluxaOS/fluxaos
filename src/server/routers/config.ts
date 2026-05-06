import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { project } from '@/core/db/schema';
import { DELETE_ROLES, EDIT_ROLES } from '@/core/features/roles';
import { NotFoundError } from '@/core/errors/domain';
import { createConfigService } from '@/core/services/config';
import { inputId, protectedMutation, publicProcedure, router } from '../trpc';

export const configRouter = router({
  list: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Ownership check: verify the requesting user owns this project.
      // Skip when fluxaUserId is null (LAN auth bypass = admin role).
      if (ctx.viewer.fluxaUserId !== null) {
        const [proj] = await ctx.db
          .select({ userId: project.userId })
          .from(project)
          .where(eq(project.id, input.projectId));
        if (!proj) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Project not found: ${input.projectId}`,
          });
        }
        if (proj.userId !== ctx.viewer.fluxaUserId) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'You do not have access to this project.',
          });
        }
      }
      return createConfigService(ctx.db).listByProject(input.projectId);
    }),

  getById: publicProcedure.input(inputId()).query(async ({ ctx, input }) => {
    const row = await createConfigService(ctx.db).getById(input.id);
    if (!row)
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Config entry not found: ${input.id}`,
      });
    return row;
  }),

  create: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        scope: z.string().min(1).default('global'),
        projectId: z.string().uuid().nullable().optional(),
        key: z.string().min(1),
        value: z.unknown(),
        changedBy: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createConfigService(ctx.db).create({
        scope: input.scope,
        projectId: input.projectId ?? null,
        key: input.key,
        value: input.value,
        changedBy: input.changedBy ?? null,
      });
    }),

  update: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        scope: z.string().min(1).optional(),
        key: z.string().min(1).optional(),
        value: z.unknown().optional(),
        changedBy: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      try {
        return await createConfigService(ctx.db).update(id, version, data);
      } catch (err) {
        if (err instanceof NotFoundError) {
          throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
        }
        throw err;
      }
    }),

  delete: protectedMutation(DELETE_ROLES)
    .input(z.object({ id: z.string().uuid(), version: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await createConfigService(ctx.db).delete(input.id, input.version);
      } catch (err) {
        if (err instanceof NotFoundError) {
          throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
        }
        throw err;
      }
    }),
});
