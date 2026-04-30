import { z } from 'zod/v4';
import { createBrandService } from '@/core/services';
import { publicProcedure, router } from '../trpc';

const jsonObject = z.record(z.string(), z.unknown());

export const brandRouter = router({
  listByOrg: publicProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      createBrandService(ctx.db).listByOrg(input.orgId)
    ),

  listVisibleToProject: publicProcedure
    .input(z.object({ orgId: z.string().uuid(), projectId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      createBrandService(ctx.db).listVisibleToProject(
        input.orgId,
        input.projectId
      )
    ),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => createBrandService(ctx.db).getById(input.id)),

  create: publicProcedure
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
    .mutation(({ ctx, input }) => createBrandService(ctx.db).create(input)),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        projectId: z.string().uuid().nullable().optional(),
        name: z.string().min(1).optional(),
        colors: jsonObject.nullable().optional(),
        fonts: jsonObject.nullable().optional(),
        toneOfVoice: z.string().nullable().optional(),
        styleGuide: z.string().nullable().optional(),
        logoUrl: z.string().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return createBrandService(ctx.db).update(id, data);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => createBrandService(ctx.db).remove(input.id)),
});
