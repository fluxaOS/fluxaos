/**
 * Runtime feature-gating primitive.
 *
 * DEF-004 / FLX-14: This is a stub. Every feature is available to every
 * user today. When the SaaS tier model ships, wire `hasFeature()` to read
 * subscription state from `user` or `organization` and update the function
 * body.
 *
 * The function signature MUST remain stable so callers never change.
 *
 * RBAC (DEF-002) lives in a separate primitive — see
 * `src/core/features/roles.ts` and `useViewerRole()` /
 * `protectedMutation()`. Roles are not features; they're who-you-are, not
 * what-tier-you're-on.
 */
export enum Feature {
  /** DEF-001 — openclaw-style blur-on-unauthed-view */
  PREVIEW_GATE = 'preview_gate',

  /** DEF-003 — per-row revision history + revert */
  REVISION_HISTORY = 'revision_history',
}

export function hasFeature(_userId: string | null, _feature: Feature): boolean {
  // DEF-004: wire to subscription/tier state when SaaS model exists.
  // Today: every caller (signed-in or anonymous) has every feature.
  // When real gating lands, null/anonymous callers should be treated as
  // the most-restricted tier.
  return true;
}
