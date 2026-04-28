/**
 * FLX-12 — role-based permissions.
 *
 * Three roles for the alpha permission model:
 *   admin      — full edit/delete/revert across all settings
 *   maintainer — edit + revert; cannot delete
 *   viewer     — read-only
 *
 * Role lives on `user.role` (text NOT NULL DEFAULT 'admin'). Existing
 * rows were grandfathered to 'admin' by migration 0016.
 *
 * Server-side enforcement uses `requireRole()` inside tRPC mutations
 * (see `src/server/trpc.ts`). UI-side gates use `canRole()` to disable
 * Edit / Delete / Revert affordances — the UI gate is courtesy; the
 * server gate is the actual security boundary.
 */

export type Role = 'admin' | 'maintainer' | 'viewer';

export const ROLE_VALUES: readonly Role[] = ['admin', 'maintainer', 'viewer'];

/** Coerce arbitrary user.role values to a known Role. Unknown → 'viewer'. */
export function asRole(value: string | null | undefined): Role {
  if (value === 'admin' || value === 'maintainer' || value === 'viewer') {
    return value;
  }
  return 'viewer';
}

/** True if `role` is allowed to perform actions tagged for `required`. */
export function canRole(role: Role, required: readonly Role[]): boolean {
  return required.includes(role);
}

/** Roles allowed to edit a record (driver/skill/etc). */
export const EDIT_ROLES: readonly Role[] = ['admin', 'maintainer'];

/** Roles allowed to delete a record. */
export const DELETE_ROLES: readonly Role[] = ['admin'];

/** Roles allowed to revert a record to a prior revision. */
export const REVERT_ROLES: readonly Role[] = ['admin', 'maintainer'];
