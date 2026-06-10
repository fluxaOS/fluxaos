/**
 * Shared project access-check helpers for tRPC routers (FLX-247, FLX-239).
 *
 * Single source of truth for "can the caller access this project?" logic.
 * Previously duplicated across config.ts, issue.ts, and pipeline.ts with
 * slight variations in error codes.
 *
 * Each caller preserves its original observable behaviour via the
 * `notOwnedCode` parameter:
 *   - 'NOT_FOUND'  (default) — avoids leaking resource existence to outsiders
 *   - 'FORBIDDEN'  — explicit access-denied signal when leaking existence is ok
 *
 * The LAN auth bypass (fluxaUserId === null and
 * FLUXAOS_LAN_AUTH_BYPASS=1) is allowed through for dev/Playwright.
 */
import { TRPCError } from '@trpc/server';
import { and, eq, or } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { project, projectMember, teamMember } from '@/core/db/schema';

type OwnershipErrorCode = 'NOT_FOUND' | 'FORBIDDEN';

/**
 * Assert that the viewer is allowed to access resources in the given project.
 *
 * Access is granted by either an explicit `project_member` row or membership in
 * the project's owning team via `team_member`.
 *
 * @param db            Database connection
 * @param projectId     The project being accessed
 * @param fluxaUserId   ctx.viewer.fluxaUserId — null is allowed only when
 *                      FLUXAOS_LAN_AUTH_BYPASS=1
 * @param notFoundMsg   Message for the NOT_FOUND error when the project row is missing.
 *                      Omitted from the TRPCError when undefined.
 * @param notOwnedCode  Error code thrown when the project exists but is not accessible
 *                      by the caller. Defaults to 'NOT_FOUND'.
 * @param notOwnedMsg   Message for the notOwnedCode error.
 *                      Omitted from the TRPCError when undefined.
 */
export async function assertProjectAccess(
  db: Database,
  projectId: string,
  fluxaUserId: string | null,
  {
    notFoundMsg,
    notOwnedCode = 'NOT_FOUND' as OwnershipErrorCode,
    notOwnedMsg,
  }: {
    notFoundMsg?: string;
    notOwnedCode?: OwnershipErrorCode;
    notOwnedMsg?: string;
  } = {}
): Promise<void> {
  if (fluxaUserId === null && process.env.FLUXAOS_LAN_AUTH_BYPASS === '1') {
    return;
  }

  if (fluxaUserId === null) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authenticated user required.',
    });
  }

  const [proj] = await db
    .select({ id: project.id, teamId: project.teamId })
    .from(project)
    .where(eq(project.id, projectId));

  if (!proj) {
    throw new TRPCError({ code: 'NOT_FOUND', message: notFoundMsg });
  }

  const [membership] = await db
    .select({ projectId: project.id })
    .from(project)
    .leftJoin(
      projectMember,
      and(
        eq(projectMember.projectId, project.id),
        eq(projectMember.userId, fluxaUserId)
      )
    )
    .leftJoin(
      teamMember,
      and(
        eq(teamMember.teamId, project.teamId),
        eq(teamMember.userId, fluxaUserId)
      )
    )
    .where(
      and(
        eq(project.id, projectId),
        or(
          eq(projectMember.userId, fluxaUserId),
          eq(teamMember.userId, fluxaUserId)
        )
      )
    );

  if (!membership) {
    throw new TRPCError({ code: notOwnedCode, message: notOwnedMsg });
  }
}
