import { z } from 'zod/v4';
import { createOrganizationService } from '@/core/services';
import { publicProcedure, router } from '../trpc';

export const organizationRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return createOrganizationService(ctx.db).list();
  }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createOrganizationService(ctx.db).getById(input.id);
    }),

  getBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(({ ctx, input }) => {
      return createOrganizationService(ctx.db).getBySlug(input.slug);
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        slug: z.string().min(1),
        settings: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      return createOrganizationService(ctx.db).create(input);
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return createOrganizationService(ctx.db).update(id, data);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      return createOrganizationService(ctx.db).remove(input.id);
    }),
});
