/**
 * Runtime feature-gating primitive.
 *
 * DEF-004: This is a stub. Every feature is available to every user today.
 * When the SaaS tier model ships, wire `hasFeature()` to read subscription
 * state from `user` or `organization` and update the function body.
 *
 * The function signature MUST remain stable so callers never change.
 *
 * Callers should use this to gate deferred features that already have UI
 * hooks in place — see DEF-001 (preview gate), DEF-002 (RBAC),
 * DEF-003 (revision history).
 */
export enum Feature {
  /** DEF-001 — openclaw-style blur-on-unauthed-view */
  PREVIEW_GATE = 'preview_gate',

  /** DEF-002 — role checks on edit/delete buttons */
  ROLE_BASED_PERMISSIONS = 'role_based_permissions',

  /** DEF-003 — per-row revision history + revert */
  REVISION_HISTORY = 'revision_history',
}

export function hasFeature(_userId: string, _feature: Feature): boolean {
  // DEF-004: wire to subscription/tier state when SaaS model exists.
  // Today: every user has every feature.
  return true;
}
