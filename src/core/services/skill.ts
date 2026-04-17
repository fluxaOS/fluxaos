import { eq, desc, and, count } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { skill, pipelineStage, stageRun, personaSkill } from '@/core/db/schema';
import { createCrudService } from './crud-factory';

type SkillInsert = typeof skill.$inferInsert;
type SkillSelect = typeof skill.$inferSelect;

export function createSkillService(db: Database) {
  const crud = createCrudService<SkillInsert, SkillSelect>(db, skill);

  return {
    ...crud,

    async listByProject(projectId: string): Promise<SkillSelect[]> {
      return db
        .select()
        .from(skill)
        .where(eq(skill.projectId, projectId))
        .orderBy(desc(skill.createdAt));
    },

    async listGlobal(): Promise<SkillSelect[]> {
      return db
        .select()
        .from(skill)
        .where(eq(skill.scope, 'global'))
        .orderBy(desc(skill.createdAt));
    },

    /**
     * Optimistic-lock update. Returns null if the expected version is stale.
     * Bumps version on success.
     */
    async updateWithVersion(
      id: string,
      expectedVersion: number,
      data: Partial<SkillInsert>,
    ): Promise<SkillSelect | null> {
      const [row] = await db
        .update(skill)
        .set({
          ...data,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(skill.id, id), eq(skill.version, expectedVersion)))
        .returning();
      return (row as SkillSelect) ?? null;
    },

    /**
     * Count references to this skill across all FK-holding tables.
     * Used to produce meaningful delete-failure messages.
     */
    async countReferences(id: string): Promise<{
      pipelineStages: number;
      stageRuns: number;
      personaSkills: number;
    }> {
      const [ps] = await db
        .select({ c: count() })
        .from(pipelineStage)
        .where(eq(pipelineStage.skillId, id));
      const [sr] = await db
        .select({ c: count() })
        .from(stageRun)
        .where(eq(stageRun.skillId, id));
      const [psk] = await db
        .select({ c: count() })
        .from(personaSkill)
        .where(eq(personaSkill.skillId, id));
      return {
        pipelineStages: Number(ps?.c ?? 0),
        stageRuns: Number(sr?.c ?? 0),
        personaSkills: Number(psk?.c ?? 0),
      };
    },

    /**
     * Optimistic-lock delete. Returns true if the row was deleted at the
     * expected version; false if version was stale (no row deleted).
     */
    async deleteWithVersion(id: string, expectedVersion: number): Promise<boolean> {
      const result = await db
        .delete(skill)
        .where(and(eq(skill.id, id), eq(skill.version, expectedVersion)))
        .returning({ id: skill.id });
      return result.length > 0;
    },
  };
}

export type SkillService = ReturnType<typeof createSkillService>;
