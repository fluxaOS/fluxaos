import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { project } from '@/core/db/schema';
import { DELETE_ROLES, EDIT_ROLES } from '@/core/features/roles';
import { createTeamService } from '@/core/services';
import { assertProjectAccess } from '../ownership';
import { protectedMutation, publicProcedure, router } from '../trpc';

export const teamRouter = router({
  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(
        ctx.db,
        input.projectId,
        ctx.viewer.fluxaUserId,
        {
          notOwnedCode: 'FORBIDDEN',
        }
      );
      return createTeamService(ctx.db).listByProject(input.projectId);
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => createTeamService(ctx.db).getById(input.id)),

  create: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [proj] = await ctx.db
        .select({ orgId: project.orgId })
        .from(project)
        .where(eq(project.id, input.projectId));
      if (!proj) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Project not found: ${input.projectId}`,
        });
      }
      await assertProjectAccess(
        ctx.db,
        input.projectId,
        ctx.viewer.fluxaUserId,
        {
          notOwnedCode: 'FORBIDDEN',
        }
      );
      return createTeamService(ctx.db).create({
        orgId: proj.orgId,
        name: input.name,
        description: input.description,
      });
    }),

  update: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      const projectRows = await ctx.db
        .select({ id: project.id })
        .from(project)
        .where(eq(project.teamId, id));
      for (const row of projectRows) {
        await assertProjectAccess(ctx.db, row.id, ctx.viewer.fluxaUserId, {
          notOwnedCode: 'FORBIDDEN',
        });
      }
      const row = await createTeamService(ctx.db).updateWithVersion(
        id,
        version,
        data
      );
      if (!row)
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Optimistic concurrency conflict',
        });
      return row;
    }),

  delete: protectedMutation(DELETE_ROLES)
    .input(z.object({ id: z.string().uuid(), version: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const projectRows = await ctx.db
        .select({ id: project.id })
        .from(project)
        .where(eq(project.teamId, input.id));
      for (const row of projectRows) {
        await assertProjectAccess(ctx.db, row.id, ctx.viewer.fluxaUserId, {
          notOwnedCode: 'FORBIDDEN',
        });
      }
      return ctx.db.transaction(async (tx) => {
        const svc = createTeamService(tx);
        const refs = await svc.countReferences(input.id);
        if (refs.members > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Cannot delete team — referenced by ${refs.members} member(s). Remove members first.`,
          });
        }
        const ok = await svc.deleteWithVersion(input.id, input.version);
        if (!ok) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'Optimistic concurrency conflict — team was modified elsewhere.',
          });
        }
        return { id: input.id };
      });
    }),
});
