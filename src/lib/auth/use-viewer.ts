'use client';

/**
 * Unified viewer-permission hooks — FLX-12 (roles) and FLX-14 (tiers).
 *
 * Both hooks follow the same pattern: query the viewer's effective value from
 * tRPC, normalise with the domain helper, and return a conservative default
 * while loading. Consolidated here to avoid structural duplication.
 *
 * The server-side enforcement (protectedMutation / featureGated) is the
 * actual security boundary; these hooks disable buttons before the click.
 */

import type { Feature } from '@/core/features/features';
import { hasFeature } from '@/core/features/features';
import {
  asRole,
  canRole,
  DELETE_ROLES,
  EDIT_ROLES,
  REVERT_ROLES,
  type Role,
} from '@/core/features/roles';
import { asTier, type Tier } from '@/core/features/tiers';
import { trpc } from '@/lib/trpc/client';

// ─── Role hooks (FLX-12) ────────────────────────────────────────────────────

export function useViewerRole(): Role {
  const { data } = trpc.user.viewerRole.useQuery();
  return asRole(data?.role);
}

export function useCanEdit(): boolean {
  return canRole(useViewerRole(), EDIT_ROLES);
}

export function useCanDelete(): boolean {
  return canRole(useViewerRole(), DELETE_ROLES);
}

export function useCanRevert(): boolean {
  return canRole(useViewerRole(), REVERT_ROLES);
}

// ─── Tier hooks (FLX-14) ────────────────────────────────────────────────────

export function useViewerTier(): Tier {
  const { data } = trpc.user.viewerTier.useQuery();
  return asTier(data?.tier);
}

export function useHasFeature(feature: Feature): boolean {
  return hasFeature(useViewerTier(), feature);
}
