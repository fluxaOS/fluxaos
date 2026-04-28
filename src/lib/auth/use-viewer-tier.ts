'use client';

/**
 * FLX-14 — read the viewer's effective subscription tier on the client.
 *
 * Wraps the `user.viewerTier` tRPC query so settings pages can gate
 * paywalled affordances. The actual paywall boundary is enforced
 * server-side via `featureGated()` — this is a courtesy gate to disable
 * buttons before the user clicks them.
 *
 * Returns `'free'` while the query is loading so the UI is conservative
 * during the brief load window.
 */

import type { Feature } from '@/core/features/features';
import { hasFeature } from '@/core/features/features';
import { asTier, type Tier } from '@/core/features/tiers';
import { trpc } from '@/lib/trpc/client';

export function useViewerTier(): Tier {
  const { data } = trpc.user.viewerTier.useQuery();
  return asTier(data?.tier);
}

export function useHasFeature(feature: Feature): boolean {
  const tier = useViewerTier();
  return hasFeature(tier, feature);
}
