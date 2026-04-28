'use client';

/**
 * FLX-12 — read the viewer's effective role on the client.
 *
 * Wraps the `user.viewerRole` tRPC query so settings pages can gate Edit /
 * Delete / Revert affordances. The actual security boundary is enforced
 * server-side via `protectedMutation()` — this is a courtesy gate to
 * disable buttons before the user clicks them.
 *
 * Returns `'viewer'` while the query is loading so the UI is conservative
 * during the brief load window.
 */

import {
  asRole,
  canRole,
  DELETE_ROLES,
  EDIT_ROLES,
  REVERT_ROLES,
  type Role,
} from '@/core/features/roles';
import { trpc } from '@/lib/trpc/client';

export function useViewerRole(): Role {
  const { data } = trpc.user.viewerRole.useQuery();
  return asRole(data?.role);
}

export function useCanEdit(): boolean {
  const role = useViewerRole();
  return canRole(role, EDIT_ROLES);
}

export function useCanDelete(): boolean {
  const role = useViewerRole();
  return canRole(role, DELETE_ROLES);
}

export function useCanRevert(): boolean {
  const role = useViewerRole();
  return canRole(role, REVERT_ROLES);
}
