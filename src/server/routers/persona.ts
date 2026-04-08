import { z } from 'zod';
import {
  attachSkill,
  createPersona,
  deletePersona,
  detachSkill,
  getPersona,
  listPersonaSkills,
  listPersonas,
  resolvePersona,
  updatePersona,
} from '@/core/personas';
import { publicProcedure, router } from '@/server/trpc';

const personaScopeEnum = z.enum(['global', 'project']);

export const personaRouter = router({
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        scope: personaScopeEnum.optional(),
        projectId: z.string().uuid().optional(),
        soul: z.string().optional(),
        identity: z.record(z.string(), z.unknown()).optional(),
        brandId: z.string().uuid().optional(),
        routingProfileId: z.string().uuid().optional(),
        parentPersonaId: z.string().uuid().optional(),
      })
    )
    .mutation(({ input }) => createPersona(input)),

  list: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().uuid().optional(),
          scope: personaScopeEnum.optional(),
        })
        .optional()
    )
    .query(({ input }) => listPersonas(input)),

  getById: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        resolve: z.boolean().optional(),
      })
    )
    .query(({ input }) =>
      input.resolve ? resolvePersona(input.id) : getPersona(input.id)
    ),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        scope: personaScopeEnum.optional(),
        projectId: z.string().uuid().optional(),
        soul: z.string().optional(),
        identity: z.record(z.string(), z.unknown()).optional(),
        brandId: z.string().uuid().optional(),
        routingProfileId: z.string().uuid().optional(),
        parentPersonaId: z.string().uuid().optional(),
      })
    )
    .mutation(({ input }) => {
      const { id, ...updates } = input;
      return updatePersona(id, updates);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => deletePersona(input.id)),

  attachSkill: publicProcedure
    .input(
      z.object({
        personaId: z.string().uuid(),
        skillId: z.string().uuid(),
        configOverrides: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(({ input }) =>
      attachSkill(input.personaId, input.skillId, input.configOverrides)
    ),

  detachSkill: publicProcedure
    .input(
      z.object({
        personaId: z.string().uuid(),
        skillId: z.string().uuid(),
      })
    )
    .mutation(({ input }) => detachSkill(input.personaId, input.skillId)),

  skills: publicProcedure
    .input(z.object({ personaId: z.string().uuid() }))
    .query(({ input }) => listPersonaSkills(input.personaId)),
});
