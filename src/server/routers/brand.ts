import { z } from 'zod';
import {
  createBrand,
  deleteBrand,
  getBrand,
  listBrands,
  updateBrand,
} from '@/core/brands';
import { publicProcedure, router } from '@/server/trpc';

export const brandRouter = router({
  create: publicProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
        name: z.string().min(1),
        colors: z.record(z.string(), z.unknown()).optional(),
        fonts: z.record(z.string(), z.unknown()).optional(),
        toneOfVoice: z.string().optional(),
        styleGuide: z.string().optional(),
        logoUrl: z.string().url().optional(),
      })
    )
    .mutation(({ input }) => createBrand(input)),

  list: publicProcedure
    .input(
      z
        .object({
          orgId: z.string().uuid().optional(),
          projectId: z.string().uuid().optional(),
        })
        .optional()
    )
    .query(({ input }) => listBrands(input)),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getBrand(input.id)),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        colors: z.record(z.string(), z.unknown()).optional(),
        fonts: z.record(z.string(), z.unknown()).optional(),
        toneOfVoice: z.string().optional(),
        styleGuide: z.string().optional(),
        logoUrl: z.string().url().optional(),
      })
    )
    .mutation(({ input }) => {
      const { id, ...updates } = input;
      return updateBrand(id, updates);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => deleteBrand(input.id)),
});
