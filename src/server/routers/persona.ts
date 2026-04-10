import { z } from 'zod/v4';
import { eq, and } from 'drizzle-orm';
import { router, publicProcedure } from '../trpc';
import { createPersonaService } from '@/core/services';
import { personaSkill, skill } from '@/core/db/schema';

export const personaRouter = router({
  list: publicProcedure.query(({ ctx }) => {
    return createPersonaService(ctx.db).list();
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
    .input(z.object({
      scope: z.enum(['global', 'project']),
      projectId: z.string().uuid().optional(),
      name: z.string().min(1),
      soul: z.string().optional(),
      identity: z.unknown().optional(),
      brandId: z.string().uuid().optional(),
      routingProfileId: z.string().uuid().optional(),
      parentPersonaId: z.string().uuid().optional(),
    }))
    .mutation(({ ctx, input }) => {
      return createPersonaService(ctx.db).create(input);
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      soul: z.string().optional(),
      identity: z.unknown().optional(),
      brandId: z.string().uuid().optional(),
      routingProfileId: z.string().uuid().optional(),
    }))
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return createPersonaService(ctx.db).update(id, data);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => {
      return createPersonaService(ctx.db).remove(input.id);
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
    .input(z.object({
      personaId: z.string().uuid(),
      skillId: z.string().uuid(),
    }))
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
    .input(z.object({
      personaId: z.string().uuid(),
      skillId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(personaSkill)
        .where(
          and(
            eq(personaSkill.personaId, input.personaId),
            eq(personaSkill.skillId, input.skillId),
          ),
        );
      return { detached: true };
    }),
});
