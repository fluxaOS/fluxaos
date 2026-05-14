import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import { buildGitRouter } from '@/adapters/git-router/validator-registry';
import {
  BadRequestError,
  InternalError,
  NotFoundError,
} from '@/core/errors/domain';
import { DELETE_ROLES, EDIT_ROLES } from '@/core/features/roles';
import { createProjectService } from '@/core/services';
import { inputId, protectedMutation, publicProcedure, router } from '../trpc';

export const projectRouter = router({
  /**
   * List projects scoped to the given org.
   * Replaces the banned unscoped crud-factory `list()`.
   */
  list: publicProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createProjectService(ctx.db).listByOrg(input.orgId);
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

  getById: publicProcedure.input(inputId()).query(({ ctx, input }) => {
    return createProjectService(ctx.db).getById(input.id);
  }),

  getBySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return createProjectService(ctx.db).getFirstBySlug(input.slug);
    }),

  create: protectedMutation(EDIT_ROLES)
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

  update: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        slug: z
          .string()
          .min(1)
          .regex(/^[a-z0-9-]+$/, 'SLUG_INVALID_FORMAT')
          .optional(),
        repoUrl: z.string().url().nullable().optional(),
        defaultBranch: z.string().min(1).optional(),
        defaultPipelineId: z.string().uuid().nullable().optional(),
        brandId: z.string().uuid().nullable().optional(),
        // FLX-221: per-project absolute path to the on-disk clone of the
        // target repo. Null means the stage-runner will refuse to acquire
        // an isolation env for this project.
        targetRepoPath: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      try {
        return await createProjectService(ctx.db, {
          repoUrlValidator: buildGitRouter(),
        }).update(id, data);
      } catch (err) {
        // Map core domain errors to transport-layer TRPCError so HTTP
        // behavior is unchanged. Core stays free of @trpc/server (FLX-242).
        if (err instanceof NotFoundError) {
          throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
        }
        if (err instanceof BadRequestError) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: err.message,
            cause: err.detail,
          });
        }
        if (err instanceof InternalError) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: err.message,
          });
        }
        throw err;
      }
    }),

  delete: protectedMutation(DELETE_ROLES)
    .input(inputId())
    .mutation(({ ctx, input }) => {
      return createProjectService(ctx.db).remove(input.id);
    }),
  /**
   * FLX-227: liveness check on a repo URL. Walks the registered git
   * provider validators (vendor-agnostic) and returns a structured
   * ValidationResult. Called by the Projects form's "Validate" button
   * and re-run by project.update on save. Never used as a fallback.
   */
  validateRepoUrl: protectedMutation(EDIT_ROLES)
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ input }) => {
      const router = buildGitRouter();
      return router.validate(input.url);
    }),
});
