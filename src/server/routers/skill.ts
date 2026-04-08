import { z } from 'zod';
import {
  createSkill,
  deleteSkill,
  getSkill,
  listSkills,
  materializeSkills,
  updateSkill,
} from '@/core/skills';
import { publicProcedure, router } from '@/server/trpc';

const skillScopeEnum = z.enum(['global', 'project']);

export const skillRouter = router({
  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        promptTemplate: z.string().optional(),
        inputSchema: z.record(z.string(), z.unknown()).optional(),
        outputSchema: z.record(z.string(), z.unknown()).optional(),
        tags: z.array(z.string()).optional(),
        scope: skillScopeEnum.optional(),
        projectId: z.string().uuid().optional(),
      })
    )
    .mutation(({ input }) => createSkill(input)),

  list: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().uuid().optional(),
          scope: skillScopeEnum.optional(),
          tags: z.array(z.string()).optional(),
        })
        .optional()
    )
    .query(({ input }) => listSkills(input)),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ input }) => getSkill(input.id)),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        promptTemplate: z.string().optional(),
        inputSchema: z.record(z.string(), z.unknown()).optional(),
        outputSchema: z.record(z.string(), z.unknown()).optional(),
        tags: z.array(z.string()).optional(),
        scope: skillScopeEnum.optional(),
      })
    )
    .mutation(({ input }) => {
      const { id, ...updates } = input;
      return updateSkill(id, updates);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => deleteSkill(input.id)),

  materialize: publicProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        targetDir: z.string().min(1),
      })
    )
    .mutation(({ input }) =>
      materializeSkills(input.projectId, input.targetDir)
    ),
});
