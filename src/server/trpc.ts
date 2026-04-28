/**
 * tRPC initialization — creates the router and procedure helpers.
 *
 * Context includes the database instance resolved via the adapter registry
 * and the resolved viewer (FLX-12). The viewer is the Supabase-authenticated
 * user mapped to the corresponding row in the `user` table; under the
 * homelab LAN auth bypass (FLUXAOS_LAN_AUTH_BYPASS=1) the viewer falls back
 * to an admin no-id sentinel so journey tests and homelab dev keep working.
 */
import { initTRPC, TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import type { Database } from '@/core/db/connection';
import { user } from '@/core/db/schema';
import { asRole, canRole, type Role } from '@/core/features/roles';
import type { DatabaseProvider } from '@/core/ports/database';
import { createClient } from '@/lib/supabase/server';

export type Viewer = {
  /** Supabase auth user id, or null when the LAN bypass is active. */
  authUserId: string | null;
  /** Resolved fluxaOS user row id, or null when no row matches. */
  fluxaUserId: string | null;
  /** Effective role used for permission checks. */
  role: Role;
};

export interface TRPCContext {
  db: Database;
  viewer: Viewer;
}

const LAN_BYPASS_ROLE: Role = 'admin';

async function resolveViewer(db: Database): Promise<Viewer> {
  // Homelab LAN auth bypass: middleware skips the /login redirect, so no
  // session cookie exists. Treat the request as an admin to keep journey
  // tests and the single-user homelab flow working.
  if (process.env.FLUXAOS_LAN_AUTH_BYPASS === '1') {
    return { authUserId: null, fluxaUserId: null, role: LAN_BYPASS_ROLE };
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
    return { authUserId: null, fluxaUserId: null, role: 'viewer' };
  }

  const [row] = await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(eq(user.id, authUserId));

  if (!row) {
    return { authUserId, fluxaUserId: null, role: 'viewer' };
  }
  return {
    authUserId,
    fluxaUserId: row.id,
    role: asRole(row.role),
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
