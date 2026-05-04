import { count, desc, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { team, teamMember } from '@/core/db/schema';
import { createVersionedCrudService } from './crud-factory';

type TeamInsert = typeof team.$inferInsert;
type TeamSelect = typeof team.$inferSelect;

type DbOrTx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;

export function createTeamService(db: DbOrTx) {
  const crud = createVersionedCrudService<TeamInsert, TeamSelect>(
    db as Database,
    team
  );

  return {
    ...crud,

    async listByProject(projectId: string): Promise<TeamSelect[]> {
      return db
        .select()
        .from(team)
        .where(eq(team.projectId, projectId))
        .orderBy(desc(team.createdAt));
    },

    async countReferences(id: string): Promise<{ members: number }> {
      const [m] = await db
        .select({ c: count() })
        .from(teamMember)
        .where(eq(teamMember.teamId, id));
      return { members: Number(m?.c ?? 0) };
    },
  };
}

export type TeamService = ReturnType<typeof createTeamService>;
