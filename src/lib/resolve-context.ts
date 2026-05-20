/**
 * Resolves org, team, user, and project from the project UUID route.
 */
import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import {
  organization,
  project,
  projectMember,
  team,
  user,
} from '@/core/db/schema';
import type { DatabaseProvider } from '@/core/ports/database';

export async function resolveContext(projectUuid: string) {
  bootstrap();
  const db = registry.get<DatabaseProvider>('database').getConnection();

  const [row] = await db
    .select({
      org: organization,
      team,
      user,
      project,
    })
    .from(project)
    .innerJoin(organization, eq(organization.id, project.orgId))
    .innerJoin(team, eq(team.id, project.teamId))
    .innerJoin(projectMember, eq(projectMember.projectId, project.id))
    .innerJoin(
      user,
      and(eq(user.id, projectMember.userId), eq(user.orgId, project.orgId))
    )
    .where(eq(project.id, projectUuid))
    .limit(1);

  if (!row) notFound();

  return {
    db,
    org: row.org,
    team: row.team,
    user: row.user,
    project: row.project,
    orgId: row.org.id,
    teamId: row.team.id,
    userId: row.user.id,
    projectId: row.project.id,
  };
}
