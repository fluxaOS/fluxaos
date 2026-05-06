import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { personaSkill, skill } from '@/core/db/schema';
import { createPersonaService } from '@/core/services';
import { publicProcedure, router } from '../trpc';

export const personaRouter = router({
  /**
   * List personas scoped to the given project (or global if projectId is
   * omitted — global personas have scope='global' and null projectId).
   * Replaces the banned unscoped crud-factory `list()`.
   */
  list: publicProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }))
    .query(({ ctx, input }) => {
      const svc = createPersonaService(ctx.db);
      return input.projectId
        ? svc.listByProject(input.projectId)
        : svc.listGlobal();
    }),

  listByProject: publicProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createPersonaService(ctx.db).listByProject(input.projectId);
    }),

  listGlobal: publicProcedure.query(({ ctx }) => {
    return createPersonaService(ctx.db).listGlobal();
  }),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => {
      return createPersonaService(ctx.db).getById(input.id);
    }),

  create: publicProcedure
    .input(
      z.object({
        scope: z.enum(['global', 'project']),
        projectId: z.string().uuid().optional(),
        name: z.string().min(1),
        soul: z.string().optional(),
        identity: z.unknown().optional(),
        brandId: z.string().uuid().nullable().optional(),
        routingProfileId: z.string().uuid().optional(),
        parentPersonaId: z.string().uuid().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      return createPersonaService(ctx.db).create(input);
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        name: z.string().min(1).optional(),
        soul: z.string().optional(),
        identity: z.unknown().optional(),
        brandId: z.string().uuid().nullable().optional(),
        routingProfileId: z.string().uuid().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      const row = await createPersonaService(ctx.db).updateWithVersion(
        id,
        version,
        data
      );
      if (!row)
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Optimistic concurrency conflict',
        });
      return row;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid(), version: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      return await ctx.db.transaction(async (tx) => {
        const svc = createPersonaService(tx);

        // FK guard: reject with a meaningful message if anything still points here
        const refs = await svc.countReferences(input.id);
        if (refs.pipelineStages > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Cannot delete persona — referenced by ${refs.pipelineStages} pipeline stage(s). Remove references first.`,
          });
        }

        const ok = await svc.deleteWithVersion(input.id, input.version);
        if (!ok) {
          throw new TRPCError({
            code: 'CONFLICT',
            message:
              'Optimistic concurrency conflict — persona was modified elsewhere.',
          });
        }
        return { id: input.id };
      });
    }),

  /** List skills attached to a persona. */
  skills: publicProcedure
    .input(z.object({ personaId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          personaId: personaSkill.personaId,
          skillId: personaSkill.skillId,
          enabled: personaSkill.enabled,
          skillName: skill.name,
        })
        .from(personaSkill)
        .innerJoin(skill, eq(personaSkill.skillId, skill.id))
        .where(eq(personaSkill.personaId, input.personaId));
      return rows;
    }),

  /** Attach a skill to a persona. */
  attachSkill: publicProcedure
    .input(
      z.object({
        personaId: z.string().uuid(),
        skillId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(personaSkill)
        .values({
          personaId: input.personaId,
          skillId: input.skillId,
          enabled: true,
        })
        .onConflictDoNothing()
        .returning();
      return row ?? null;
    }),

  /** Detach a skill from a persona. */
  detachSkill: publicProcedure
    .input(
      z.object({
        personaId: z.string().uuid(),
        skillId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(personaSkill)
        .where(
          and(
            eq(personaSkill.personaId, input.personaId),
            eq(personaSkill.skillId, input.skillId)
          )
        );
      return { detached: true };
    }),
});
