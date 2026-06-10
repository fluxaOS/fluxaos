import { count, desc, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { project, team, teamMember } from '@/core/db/schema';
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

    /**
     * Teams visible from a project: every team in the project's org
     * (FLX-239 — teams are org-scoped). Settings → Teams manages the org's
     * teams from a project context, and team.create derives the org from
     * the same project, so the list and the create surface must agree.
     * (Previously this joined on project.team_id and returned only the
     * owning team — freshly created teams never appeared. FLX-266.)
     */
    async listByProject(projectId: string): Promise<TeamSelect[]> {
      const rows = await db
        .select({ team })
        .from(team)
        .innerJoin(project, eq(project.orgId, team.orgId))
        .where(eq(project.id, projectId))
        .orderBy(desc(team.createdAt));
      return rows.map((row) => row.team);
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
