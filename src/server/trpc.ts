/**
 * tRPC initialization — creates the router and procedure helpers.
 *
 * Context includes the database instance resolved via the adapter registry
 * and the resolved viewer (FLX-12 role + FLX-14 tier). The viewer is the
 * Supabase-authenticated user mapped to the corresponding row in `user`,
 * with the org tier resolved from `organization.subscription_tier`. Under
 * the homelab LAN auth bypass (FLUXAOS_LAN_AUTH_BYPASS=1) the viewer
 * falls back to admin + enterprise so journey tests and homelab dev keep
 * working without requiring Supabase Auth.
 *
 * No IP-based check is applied to the bypass. Without a trusted reverse proxy
 * stripping client-supplied headers, x-forwarded-for is spoofable and
 * Next.js injects the LAN IP (e.g. 192.168.54.101) rather than 127.0.0.1 for
 * browser/Playwright connections. The env flag is the sole gate; the operator
 * contract is: do not set FLUXAOS_LAN_AUTH_BYPASS on any internet-reachable
 * host. See middleware.ts for the same rationale applied to page-layer auth.
 *
 * Single-tenant assumption: this deployment model assumes exactly one tenant.
 * TRPCContext carries no orgId/projectId — every procedure is responsible for
 * scoping queries using client-supplied input. See FLX-149 for the future
 * tenantProcedure middleware that would enforce server-derived scoping.
 */
import { initTRPC, TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import type { Database } from '@/core/db/connection';
import { organization, user } from '@/core/db/schema';
import { type Feature, hasFeature } from '@/core/features/features';
import { asRole, canRole, type Role } from '@/core/features/roles';
import { asTier, type Tier } from '@/core/features/tiers';
import type { DatabaseProvider } from '@/core/ports/database';
import { createClient } from '@/lib/supabase/server';

export type Viewer = {
  /** Supabase auth user id, or null when the LAN bypass is active. */
  authUserId: string | null;
  /** Resolved fluxaOS user row id, or null when no row matches. */
  fluxaUserId: string | null;
  /** Effective role used for permission checks (FLX-12). */
  role: Role;
  /** Effective subscription tier used for feature gates (FLX-14). */
  tier: Tier;
};

export interface TRPCContext {
  db: Database;
  viewer: Viewer;
}

const LAN_BYPASS_ROLE: Role = 'admin';
const LAN_BYPASS_TIER: Tier = 'enterprise';

async function resolveViewer(db: Database): Promise<Viewer> {
  // Homelab LAN auth bypass: middleware skips the /login redirect, so no
  // session cookie exists. The env flag is the sole gate — see file header
  // for why an IP-based check is not applied. Treats as admin + enterprise
  // to keep journey tests and the single-user homelab flow working.
  if (process.env.FLUXAOS_LAN_AUTH_BYPASS === '1') {
    return {
      authUserId: null,
      fluxaUserId: null,
      role: LAN_BYPASS_ROLE,
      tier: LAN_BYPASS_TIER,
    };
  }

  let authUserId: string | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    authUserId = data.user?.id ?? null;
  } catch {
    // Cookie store unavailable (e.g., non-request context) — treat as
    // anonymous; the protectedMutation gate will reject mutations.
    authUserId = null;
  }

  if (!authUserId) {
    return {
      authUserId: null,
      fluxaUserId: null,
      role: 'viewer',
      tier: 'free',
    };
  }

  // Single round-trip: pull user.role + organization.subscription_tier
  // via the org FK on user.
  const [row] = await db
    .select({
      id: user.id,
      role: user.role,
      tier: organization.subscriptionTier,
    })
    .from(user)
    .leftJoin(organization, eq(user.orgId, organization.id))
    .where(eq(user.id, authUserId));

  if (!row) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authenticated user is not registered in fluxaOS.',
    });
  }
  return {
    authUserId,
    fluxaUserId: row.id,
    role: asRole(row.role),
    tier: asTier(row.tier),
  };
}

export async function createTRPCContext(): Promise<TRPCContext> {
  bootstrap();
  const dbProvider = registry.get<DatabaseProvider>('database');
  const db = dbProvider.getConnection();
  const viewer = await resolveViewer(db);
  return { db, viewer };
}

const t = initTRPC.context<TRPCContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/** Shared input shape for single-record lookups by UUID primary key. */
export const inputId = () => z.object({ id: z.string().uuid() });

/**
 * FLX-12 — wrap a procedure with a role gate. Throws FORBIDDEN if the
 * viewer's role is not in `allowed`.
 */
export const protectedMutation = (allowed: readonly Role[]) =>
  t.procedure.use(({ ctx, next }) => {
    if (!canRole(ctx.viewer.role, allowed)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Required role: ${allowed.join(' | ')}. Viewer role: ${ctx.viewer.role}.`,
      });
    }
    return next({ ctx });
  });

/**
 * FLX-14 — wrap a procedure with a feature gate. Throws PAYMENT_REQUIRED
 * (the closest tRPC code to "your tier doesn't include this") when the
 * viewer's tier doesn't include `feature`.
 */
export const featureGated = (feature: Feature) =>
  t.procedure.use(({ ctx, next }) => {
    if (!hasFeature(ctx.viewer.tier, feature)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Feature ${feature} requires a higher subscription tier. Current tier: ${ctx.viewer.tier}.`,
      });
    }
    return next({ ctx });
  });
