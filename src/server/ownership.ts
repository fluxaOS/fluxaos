/**
 * Shared ownership-check helpers for tRPC routers (FLX-247).
 *
 * Single source of truth for "does the caller own this project?" logic.
 * Previously duplicated across config.ts, issue.ts, and pipeline.ts with
 * slight variations in error codes.
 *
 * Each caller preserves its original observable behaviour via the
 * `notOwnedCode` parameter:
 *   - 'NOT_FOUND'  (default) — avoids leaking resource existence to outsiders
 *   - 'FORBIDDEN'  — explicit access-denied signal when leaking existence is ok
 *
 * The LAN auth bypass (fluxaUserId === null) is always allowed through.
 */
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { project } from '@/core/db/schema';

type OwnershipErrorCode = 'NOT_FOUND' | 'FORBIDDEN';

/**
 * Assert that the viewer is allowed to access resources in the given project.
 *
 * @param db            Database connection
 * @param projectId     The project being accessed
 * @param fluxaUserId   ctx.viewer.fluxaUserId — null means LAN bypass (allowed)
 * @param notFoundMsg   Message for the NOT_FOUND error when the project row is missing.
 *                      Omitted from the TRPCError when undefined.
 * @param notOwnedCode  Error code thrown when the project exists but is not owned
 *                      by the caller. Defaults to 'NOT_FOUND'.
 * @param notOwnedMsg   Message for the notOwnedCode error.
 *                      Omitted from the TRPCError when undefined.
 */
export async function assertProjectOwnership(
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
  if (fluxaUserId === null) return; // LAN auth bypass

  const [proj] = await db
    .select({ userId: project.userId })
    .from(project)
    .where(eq(project.id, projectId));

  if (!proj) {
    throw new TRPCError({ code: 'NOT_FOUND', message: notFoundMsg });
  }

  if (proj.userId !== fluxaUserId) {
    throw new TRPCError({ code: notOwnedCode, message: notOwnedMsg });
  }
}
