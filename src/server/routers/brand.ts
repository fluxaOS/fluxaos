import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import { DELETE_ROLES, EDIT_ROLES } from '@/core/features/roles';
import { createBrandService } from '@/core/services';
import { resolveProjectScopeContext } from '@/core/services/resolve-scoped';
import { assertProjectAccess } from '../ownership';
import {
  protectedMutation,
  publicProcedure,
  router,
  type TRPCContext,
} from '../trpc';

const jsonObject = z.record(z.string(), z.unknown());

async function assertBrandProjectAccess(
  ctx: TRPCContext,
  projectId?: string | null
) {
  if (!projectId) return;
  await assertProjectAccess(ctx.db, projectId, ctx.viewer.fluxaUserId, {
    notOwnedCode: 'FORBIDDEN',
  });
}

export const brandRouter = router({
  listByOrg: publicProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      createBrandService(ctx.db).listByOrg(input.orgId)
    ),

  listVisibleToProject: publicProcedure
    .input(z.object({ orgId: z.string().uuid(), projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandProjectAccess(ctx, input.projectId);
      const scope = await resolveProjectScopeContext(
        ctx.db,
        input.projectId,
        ctx.viewer.fluxaUserId
      );
      return createBrandService(ctx.db).listEffective(scope);
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await createBrandService(ctx.db).getById(input.id);
      await assertBrandProjectAccess(ctx, row?.projectId);
      return row;
    }),

  create: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        orgId: z.string().uuid(),
        projectId: z.string().uuid().nullable().optional(),
        name: z.string().min(1),
        colors: jsonObject.nullable().optional(),
        fonts: jsonObject.nullable().optional(),
        toneOfVoice: z.string().nullable().optional(),
        styleGuide: z.string().nullable().optional(),
        logoUrl: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertBrandProjectAccess(ctx, input.projectId);
      return createBrandService(ctx.db).create(input);
    }),

  update: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        projectId: z.string().uuid().nullable().optional(),
        name: z.string().min(1).optional(),
        colors: jsonObject.nullable().optional(),
        fonts: jsonObject.nullable().optional(),
        toneOfVoice: z.string().nullable().optional(),
        styleGuide: z.string().nullable().optional(),
        logoUrl: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      const svc = createBrandService(ctx.db);
      const existing = await svc.getById(id);
      await assertBrandProjectAccess(ctx, existing?.projectId);
      const row = await svc.updateWithVersion(id, version, data);
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
      return ctx.db.transaction(async (tx) => {
        const svc = createBrandService(tx);
        const existing = await svc.getById(input.id);
        await assertBrandProjectAccess(ctx, existing?.projectId);
        const refs = await svc.countReferences(input.id);
        if (refs.personas > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Cannot delete brand — referenced by ${refs.personas} persona(s). Remove references first.`,
          });
        }
        const ok = await svc.deleteWithVersion(input.id, input.version);
        if (!ok) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'Optimistic concurrency conflict — brand was modified elsewhere.',
          });
        }
        return { id: input.id };
      });
    }),
});
