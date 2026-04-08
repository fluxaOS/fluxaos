import { z } from 'zod';
import {
  createOrganization,
  getOrganization,
  listOrganizations,
  updateOrganization,
} from '@/core/organizations';
import { publicProcedure, router } from '@/server/trpc';

export const organizationRouter = router({
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        slug: z.string().min(1),
        settings: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(({ input }) => createOrganization(input)),

  list: publicProcedure.query(() => listOrganizations()),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getOrganization(input.id)),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(({ input }) => {
      const { id, ...updates } = input;
      return updateOrganization(id, updates);
    }),
});
