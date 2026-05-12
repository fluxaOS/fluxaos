import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { brand, pipeline, project } from '@/core/db/schema';

/**
 * Per-FK scope validation. The project-service `update()` walks this map
 * for every key present in the patch; new FK columns on `project` need
 * one entry here and nothing else.
 *
 * Each validator throws TRPCError with a stable `message` key (e.g.,
 * 'PIPELINE_NOT_IN_PROJECT') that the page maps to user copy. See spec
 * §"Error message keys".
 */
export type FkValidator = (
  db: Database,
  projectId: string,
  value: unknown
) => Promise<void>;

export const FK_VALIDATORS: Record<string, FkValidator> = {
  defaultPipelineId: async (db, projectId, value) => {
    if (value == null) return;
    const [pipe] = await db
      .select()
      .from(pipeline)
      .where(eq(pipeline.id, value as string))
      .limit(1);
    if (!pipe) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'PIPELINE_NOT_FOUND',
      });
    }
    if (pipe.projectId !== projectId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'PIPELINE_NOT_IN_PROJECT',
      });
    }
  },

  brandId: async (db, projectId, value) => {
    if (value == null) return;
    const [proj] = await db
      .select()
      .from(project)
      .where(eq(project.id, projectId))
      .limit(1);
    if (!proj) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'PROJECT_NOT_FOUND' });
    }
    const [br] = await db
      .select()
      .from(brand)
      .where(eq(brand.id, value as string))
      .limit(1);
    if (!br) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'BRAND_NOT_FOUND' });
    }
    if (br.orgId !== proj.orgId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'BRAND_NOT_IN_ORG',
      });
    }
  },
};
