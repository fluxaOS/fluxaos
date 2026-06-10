/**
 * Resolves org, team, and project from the project UUID route and authorizes
 * the current session user against the project (FLX-269).
 *
 * Authorization happens inside `resolveContext` per the tenancy-waterfall
 * design (docs/superpowers/specs/2026-05-18-tenancy-waterfall-design.md):
 * the session user must hold either a direct `project_member` grant or a
 * `team_member` grant on the project's owning team, otherwise resolution
 * throws. The LAN auth bypass (FLUXAOS_LAN_AUTH_BYPASS=1) passes through
 * with a null session user, exactly like `assertProjectAccess` in
 * src/server/ownership.ts.
 */
import { and, eq, or } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import type { Database } from '@/core/db/connection';
import {
  organization,
  project,
  projectMember,
  team,
  teamMember,
} from '@/core/db/schema';
import type { DatabaseProvider } from '@/core/ports/database';
import { createClient } from '@/lib/supabase/server';

/**
 * Error raised when page-context resolution runs without an authenticated
 * session and the LAN auth bypass is not active.
 */
export class MissingSessionError extends Error {
  constructor() {
    super(
      'No authenticated session. resolveContext requires a logged-in user ' +
        'unless FLUXAOS_LAN_AUTH_BYPASS=1 is set.'
    );
    this.name = 'MissingSessionError';
  }
}

/**
 * Error raised when the session user holds neither a `project_member` grant
 * nor a `team_member` grant on the project's owning team.
 */
export class ProjectAccessDeniedError extends Error {
  readonly projectId: string;
  readonly userId: string;
  constructor(projectId: string, userId: string) {
    super(
      `User ${userId} is not a member of project ${projectId} or its owning team.`
    );
    this.name = 'ProjectAccessDeniedError';
    this.projectId = projectId;
    this.userId = userId;
  }
}

/**
 * Core resolution + authorization. Separated from session extraction so
 * integration tests can drive it against real Supabase with an explicit
 * session user id (same DI shape as `assertProjectAccess`).
 *
 * `sessionUserId === null` is allowed only when FLUXAOS_LAN_AUTH_BYPASS=1
 * (homelab single-user mode — see src/server/ownership.ts).
 */
export async function resolveProjectContext(
  db: Database,
  projectUuid: string,
  sessionUserId: string | null
) {
  const [row] = await db
    .select({
      org: organization,
      team,
      project,
    })
    .from(project)
    .innerJoin(organization, eq(organization.id, project.orgId))
    .innerJoin(team, eq(team.id, project.teamId))
    .where(eq(project.id, projectUuid))
    .limit(1);

  if (!row) notFound();

  const bypass =
    sessionUserId === null && process.env.FLUXAOS_LAN_AUTH_BYPASS === '1';

  if (!bypass) {
    if (sessionUserId === null) {
      throw new MissingSessionError();
    }

    const [membership] = await db
      .select({ projectId: project.id })
      .from(project)
      .leftJoin(
        projectMember,
        and(
          eq(projectMember.projectId, project.id),
          eq(projectMember.userId, sessionUserId)
        )
      )
      .leftJoin(
        teamMember,
        and(
          eq(teamMember.teamId, project.teamId),
          eq(teamMember.userId, sessionUserId)
        )
      )
      .where(
        and(
          eq(project.id, projectUuid),
          or(
            eq(projectMember.userId, sessionUserId),
            eq(teamMember.userId, sessionUserId)
          )
        )
      );

    if (!membership) {
      throw new ProjectAccessDeniedError(projectUuid, sessionUserId);
    }
  }

  return {
    db,
    org: row.org,
    team: row.team,
    project: row.project,
    orgId: row.org.id,
    teamId: row.team.id,
    projectId: row.project.id,
    /** Session user id; null only under the LAN auth bypass. */
    currentUserId: sessionUserId,
    /**
     * Re-asserts the access decision made at resolve time (cheap — access
     * was already validated; resolution throws before returning otherwise).
     */
    assertProjectAccess(): void {
      if (!bypass && sessionUserId === null) {
        throw new MissingSessionError();
      }
    },
  };
}

/**
 * Reads the Supabase session user id for the current request. Under the LAN
 * auth bypass no session cookie exists (middleware skips /login), so the
 * bypass short-circuits to null before touching Supabase — the same order
 * as `resolveViewer` in src/server/trpc.ts.
 */
async function resolveSessionUserId(): Promise<string | null> {
  if (process.env.FLUXAOS_LAN_AUTH_BYPASS === '1') {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new MissingSessionError();
  }
  return data.user.id;
}

export async function resolveContext(projectUuid: string) {
  bootstrap();
  const db = registry.get<DatabaseProvider>('database').getConnection();
  const sessionUserId = await resolveSessionUserId();
  return resolveProjectContext(db, projectUuid, sessionUserId);
}
