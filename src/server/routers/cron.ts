import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';
import { DELETE_ROLES, EDIT_ROLES } from '@/core/features/roles';
import { createCronService } from '@/core/services/cron';
import { inputId, protectedMutation, publicProcedure, router } from '../trpc';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Liberal cron expression check — five or six space-separated fields.
// We don't validate field semantics here; that's the runtime's concern.
const CRON_RE = /^(\S+\s+){4,5}\S+$/;

export const cronRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return createCronService(ctx.db).list();
  }),

  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return createCronService(ctx.db).listByProject(input.projectId);
    }),

  getById: publicProcedure.input(inputId()).query(async ({ ctx, input }) => {
    const row = await createCronService(ctx.db).getById(input.id);
    if (!row)
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Cron job not found: ${input.id}`,
      });
    return row;
  }),

  create: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        projectId: z.string().uuid(),
        name: z.string().min(1),
        slug: z.string().regex(SLUG_RE, 'slug must be kebab-case'),
        cronExpression: z
          .string()
          .regex(
            CRON_RE,
            'cron expression must be 5 or 6 space-separated fields'
          ),
        actionType: z.string().min(1),
        actionPayload: z.unknown().optional(),
        isEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return createCronService(ctx.db).create(input);
    }),

  update: protectedMutation(EDIT_ROLES)
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        name: z.string().min(1).optional(),
        slug: z.string().regex(SLUG_RE).optional(),
        cronExpression: z.string().regex(CRON_RE).optional(),
        actionType: z.string().min(1).optional(),
        actionPayload: z.unknown().optional(),
        isEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      return createCronService(ctx.db).update(id, version, data);
    }),

  delete: protectedMutation(DELETE_ROLES)
    .input(z.object({ id: z.string().uuid(), version: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return createCronService(ctx.db).delete(input.id, input.version);
    }),
});
