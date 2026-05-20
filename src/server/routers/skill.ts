import { z } from 'zod/v4';
import type { skill } from '@/core/db/schema';
import { Feature } from '@/core/features/features';
import { DELETE_ROLES, EDIT_ROLES, REVERT_ROLES } from '@/core/features/roles';
import { createSkillService } from '@/core/services';
import { resolveProjectScopeContext } from '@/core/services/resolve-scoped';
import { assertProjectAccess } from '../ownership';
import {
  featureGated,
  inputId,
  protectedMutation,
  publicProcedure,
  router,
  type TRPCContext,
} from '../trpc';

type SkillInsert = typeof skill.$inferInsert;

const scope = z.enum(['global', 'project']);

async function assertSkillProjectAccess(
  ctx: TRPCContext,
  projectId?: string | null
) {
  if (!projectId) return;
  await assertProjectAccess(ctx.db, projectId, ctx.viewer.fluxaUserId, {
    notOwnedCode: 'FORBIDDEN',
  });
}

export const skillRouter = router({
  /**
   * List skills scoped to the given project (or global if projectId is
   * omitted — global skills have scope='global' and null projectId).
   * Replaces the banned unscoped crud-factory `list()`.
   */
  list: publicProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const svc = createSkillService(ctx.db);
      await assertSkillProjectAccess(ctx, input.projectId);
      if (!input.projectId) return svc.listGlobal();
      const scope = await resolveProjectScopeContext(
        ctx.db,
        input.projectId,
        ctx.viewer.fluxaUserId
      );
      return svc.listEffective(scope);
    }),

  getById: publicProcedure.input(inputId()).query(async ({ ctx, input }) => {
    const row = await createSkillService(ctx.db).getById(input.id);
    await assertSkillProjectAccess(ctx, row?.projectId);
    return row;
  }),

  create: protectedMutation(EDIT_ROLES)
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertSkillProjectAccess(ctx, input.projectId);
      return createSkillService(ctx.db).create(input as SkillInsert);
    }),

  update: protectedMutation(EDIT_ROLES)
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;
      const svc = createSkillService(ctx.db);
      const existing = await svc.getById(id);
      await assertSkillProjectAccess(ctx, existing?.projectId);
      const row = await svc.updateWithVersion(
        id,
        version,
        data as Partial<SkillInsert>
      );
      if (!row) throw new Error('Optimistic concurrency conflict');
      return row;
    }),

  // FLX-14: revision history is a paid-tier feature.
  listHistory: featureGated(Feature.REVISION_HISTORY)
    .input(inputId())
    .query(async ({ ctx, input }) => {
      const svc = createSkillService(ctx.db);
      const existing = await svc.getById(input.id);
      await assertSkillProjectAccess(ctx, existing?.projectId);
      return svc.listRevisions(input.id);
    }),

  revertToRevision: protectedMutation(REVERT_ROLES)
    .input(
      z.object({
        id: z.string().uuid(),
        version: z.number().int(),
        revisionNumber: z.number().int().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const svc = createSkillService(ctx.db);
      const existing = await svc.getById(input.id);
      await assertSkillProjectAccess(ctx, existing?.projectId);
      const row = await svc.revertToRevision(
        input.id,
        input.version,
        input.revisionNumber
      );
      if (!row) throw new Error('Optimistic concurrency conflict');
      return row;
    }),

  delete: protectedMutation(DELETE_ROLES)
    .input(z.object({ id: z.string().uuid(), version: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      // Wrap the FK-count + version-locked delete in a single transaction
      // so a concurrent INSERT into pipelineStage/stageRun/personaSkill
      // between the count and the delete cannot orphan a reference.
      // (Without the transaction, countReferences could see 0, then another
      //  writer adds a row referencing this skill, then our delete succeeds
      //  and the DB's FK RESTRICT would fire — producing an unhandled
      //  tRPC 500 instead of the friendly "referenced by N" message.)
      return await ctx.db.transaction(async (tx) => {
        const svc = createSkillService(tx);
        const existing = await svc.getById(input.id);
        await assertSkillProjectAccess(ctx, existing?.projectId);

        // 1. FK guard: reject with a meaningful message if anything still points here
        const refs = await svc.countReferences(input.id);
        const total = refs.pipelineStages + refs.stageRuns + refs.personaSkills;
        if (total > 0) {
          throw new Error(
            `Cannot delete skill — referenced by ${refs.pipelineStages} pipeline stage(s), ${refs.stageRuns} stage run(s), and ${refs.personaSkills} persona binding(s). Remove references first.`
          );
        }

        // 2. Optimistic lock: only delete if version matches. Prevents deleting
        // a skill that was edited in parallel since the user saw version N.
        const ok = await svc.deleteWithVersion(input.id, input.version);
        if (!ok) {
          throw new Error(
            'Optimistic concurrency conflict — skill was modified elsewhere.'
          );
        }
        return { id: input.id };
      });
    }),
});
