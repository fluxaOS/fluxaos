import { z } from 'zod';
import {
  createProject,
  getProject,
  listProjects,
  updateProject,
} from '@/core/projects';
import { publicProcedure, router } from '@/server/trpc';

export const projectRouter = router({
  create: publicProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        name: z.string().min(1),
        slug: z.string().min(1),
        repoUrl: z.string().optional(),
      })
    )
    .mutation(({ input }) => createProject(input)),

  list: publicProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(({ input }) => listProjects(input.orgId)),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getProject(input.id)),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        repoUrl: z.string().optional(),
        defaultPipelineId: z.string().uuid().optional(),
        brandId: z.string().uuid().optional(),
      })
    )
    .mutation(({ input }) => {
      const { id, ...updates } = input;
      return updateProject(id, updates);
    }),
});
