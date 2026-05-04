import { desc, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { team } from '@/core/db/schema';
import { createVersionedCrudService } from './crud-factory';

type TeamInsert = typeof team.$inferInsert;
type TeamSelect = typeof team.$inferSelect;

export function createTeamService(db: Database) {
  const crud = createVersionedCrudService<TeamInsert, TeamSelect>(db, team);

  return {
    ...crud,

    async listByProject(projectId: string): Promise<TeamSelect[]> {
      return db
        .select()
        .from(team)
        .where(eq(team.projectId, projectId))
        .orderBy(desc(team.createdAt));
    },
  };
}

export type TeamService = ReturnType<typeof createTeamService>;
