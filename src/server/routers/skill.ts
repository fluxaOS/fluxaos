import { z } from 'zod/v4';
import { router, publicProcedure } from '../trpc';
import { createSkillService } from '@/core/services';
import type { skill } from '@/core/db/schema';

type SkillInsert = typeof skill.$inferInsert;

const scope = z.enum(['global', 'project']);

export const skillRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return createSkillService(ctx.db).list();
  }),

  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createSkillService(ctx.db).listByProject(input.projectId);
    }),

  listGlobal: publicProcedure.query(({ ctx }) => {
    return createSkillService(ctx.db).listGlobal();
  }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createSkillService(ctx.db).getById(input.id);
    }),

  create: publicProcedure
    .input(
      z.object({
        scope,
        projectId: z.string().uuid().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        promptTemplate: z.string().optional(),
        inputSchema: z.unknown().optional(),
        outputSchema: z.unknown().optional(),
        tags: z.unknown().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return createSkillService(ctx.db).create(input as SkillInsert);
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        promptTemplate: z.string().optional(),
        inputSchema: z.unknown().optional(),
        outputSchema: z.unknown().optional(),
        tags: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      const row = await createSkillService(ctx.db).updateWithVersion(
        id,
        version,
        data as Partial<SkillInsert>,
      );
      if (!row) throw new Error('Optimistic concurrency conflict');
      return row;
    }),

  countReferences: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createSkillService(ctx.db).countReferences(input.id);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid(), version: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const svc = createSkillService(ctx.db);

      // 1. FK guard: reject with a meaningful message if anything still points here
      const refs = await svc.countReferences(input.id);
      const total = refs.pipelineStages + refs.stageRuns + refs.personaSkills;
      if (total > 0) {
        throw new Error(
          `Cannot delete skill — referenced by ${refs.pipelineStages} pipeline stage(s), ${refs.stageRuns} stage run(s), and ${refs.personaSkills} persona binding(s). Remove references first.`,
        );
      }

      // 2. Optimistic lock: only delete if version matches. Prevents deleting
      // a skill that was edited in parallel since the user saw version N.
      const ok = await svc.deleteWithVersion(input.id, input.version);
      if (!ok) {
        throw new Error(
          'Optimistic concurrency conflict — skill was modified elsewhere.',
        );
      }
      return { id: input.id };
    }),
});
