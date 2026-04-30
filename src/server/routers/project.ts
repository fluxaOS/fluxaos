import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import { createPipelineService, createProjectService } from '@/core/services';
import { publicProcedure, router } from '../trpc';

export const projectRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return createProjectService(ctx.db).list();
  }),

  listByOrg: publicProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createProjectService(ctx.db).listByOrg(input.orgId);
    }),

  listByUser: publicProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createProjectService(ctx.db).listByUser(input.userId);
    }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createProjectService(ctx.db).getById(input.id);
    }),

  getBySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return createProjectService(ctx.db).getFirstBySlug(input.slug);
    }),

  create: publicProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        userId: z.string().uuid(),
        name: z.string().min(1),
        slug: z.string().min(1),
        repoUrl: z.string().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      return createProjectService(ctx.db).create(input);
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        slug: z.string().min(1).optional(),
        repoUrl: z.string().optional(),
        defaultBranch: z.string().min(1).optional(),
        defaultPipelineId: z.string().uuid().nullable().optional(),
        brandId: z.string().uuid().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return createProjectService(ctx.db).update(id, data);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      return createProjectService(ctx.db).remove(input.id);
    }),

  /**
   * Set (or clear) the project's default pipeline. Validates the
   * pipeline belongs to the project when non-null. Operators click
   * "Set as default" from the Pipelines settings tab; the server
   * enforces the project-scope invariant so a crafted UI can't point
   * a project at a pipeline from a different project.
   */
  setDefaultPipeline: publicProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        pipelineId: z.string().uuid().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.pipelineId !== null) {
        const pipe = await createPipelineService(ctx.db).getById(
          input.pipelineId
        );
        if (!pipe) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'PIPELINE_NOT_FOUND',
          });
        }
        if (pipe.projectId !== input.projectId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'PIPELINE_NOT_IN_PROJECT',
          });
        }
      }
      return createProjectService(ctx.db).update(input.projectId, {
        defaultPipelineId: input.pipelineId,
      });
    }),
});
