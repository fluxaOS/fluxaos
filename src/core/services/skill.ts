import { eq, desc } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { skill } from '@/core/db/schema';
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
  };
}

export type SkillService = ReturnType<typeof createSkillService>;
