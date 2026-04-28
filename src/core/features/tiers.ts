/**
 * FLX-14 — subscription tiers + runtime feature gating.
 *
 * Tier values live on `organization.subscription_tier`. Existing rows were
 * grandfathered to 'enterprise' by migration 0017 (so the alpha homelab org
 * keeps every feature). New orgs default to 'free'.
 *
 * Server-side enforcement uses `featureGated()` inside tRPC procedures
 * (see `src/server/trpc.ts`). UI-side gates use `tierAllowsFeature()` or
 * the `useHasFeature(feature)` hook to disable gated affordances — the UI
 * gate is courtesy; the server gate is the actual paywall boundary.
 *
 * Tier → feature mapping uses the Feature enum's *string values*
 * (e.g. 'preview_gate', 'revision_history') rather than importing the
 * Feature enum, because `features.ts` already imports `tierAllowsFeature`
 * from this module — importing Feature back would create a circular
 * module-evaluation cycle that breaks under Next/Turbopack module wrapping.
 */

export type Tier = 'free' | 'pro' | 'enterprise';

export const TIER_VALUES: readonly Tier[] = ['free', 'pro', 'enterprise'];

/** Coerce arbitrary subscription_tier values to a known Tier. Unknown → 'free'. */
export function asTier(value: string | null | undefined): Tier {
  if (value === 'free' || value === 'pro' || value === 'enterprise') {
    return value;
  }
  return 'free';
}

/**
 * Tier → set of feature string-tags. Each tier inherits its predecessor's
 * features: 'pro' includes everything 'free' has plus pro-only features.
 *
 * Today the catalog is conservative: free tier gets nothing gated. The
 * sensitive-field preview gate (FLX-11) and per-row revision history
 * (FLX-13/FLX-91) are pro-tier features in this initial wiring. As the
 * SaaS model matures, more entries land here.
 *
 * The string keys are the Feature enum's *values* — kept in sync by
 * convention (single Feature catalog in features.ts). A test in
 * `features-primitive.test.ts` asserts the catalog count.
 */
const TIER_FEATURES: Record<Tier, ReadonlySet<string>> = {
  free: new Set<string>(),
  pro: new Set<string>(['preview_gate', 'revision_history']),
  enterprise: new Set<string>(['preview_gate', 'revision_history']),
};

/** True if `tier` is allowed to use the feature with string-tag `feature`. */
export function tierAllowsFeature(tier: Tier, feature: string): boolean {
  return TIER_FEATURES[tier]?.has(feature) ?? false;
}
