/**
 * DatabaseProvider port.
 *
 * Intentional design note (invariant 7, core-stack clarification):
 * The `Database` type alias resolves to `ReturnType<typeof drizzle<typeof schema>>`.
 * This is deliberate: Drizzle ORM is core-stack infrastructure (see invariants.md §7),
 * not a pluggable vendor. The adapter boundary runs at the *connection* level —
 * different deployments may point at different Postgres instances (Supabase Cloud,
 * self-hosted, Neon) but the query layer remains Drizzle in all of them.
 *
 * Swapping Drizzle for another ORM would be a tech-stack migration, not a config change.
 */
import type { Database } from '@/core/db/connection';

export interface DatabaseProvider {
  getConnection(): Database;

  healthCheck(): Promise<boolean>;
}
