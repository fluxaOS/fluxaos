/**
 * Runtime feature-gating primitive.
 *
 * FLX-14: features are paywalled by subscription tier. The mapping from
 * tier → set of allowed features lives in `src/core/features/tiers.ts`.
 *
 * Roles (FLX-12) are a separate primitive — see `src/core/features/roles.ts`.
 * Roles are who-you-are; tiers are what-tier-the-org-is-on. Both are
 * resolved on the tRPC context (`viewer.role`, `viewer.tier`).
 */

import { type Tier, tierAllowsFeature } from './tiers';

export const Feature = {
  /** FLX-11 — sensitive-field preview gate (Preview button on prompt templates) */
  PREVIEW_GATE: 'preview_gate',

  /** FLX-13 / FLX-91 — per-row revision history + revert */
  REVISION_HISTORY: 'revision_history',
} as const;

export type Feature = (typeof Feature)[keyof typeof Feature];

/** Server primitive — true if the viewer's tier includes the feature. */
export function hasFeature(tier: Tier, feature: Feature): boolean {
  return tierAllowsFeature(tier, feature);
}
