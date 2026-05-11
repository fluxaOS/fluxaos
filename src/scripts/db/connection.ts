/**
 * Shared DB connection helper for CLI scripts.
 *
 * Usage:
 *   import { db, close } from '@/scripts/db/connection';
 *   // ... query db ...
 *   await close();
 *
 * Requires: DATABASE_URL set in .env (pgbouncer pooled connection, port 6543).
 * Consumers of this helper are read-only inspection scripts (db:issues,
 * db:runs, db:gates, db:events, etc.) and result-doc helpers — all DML/query
 * traffic, no DDL. Same shape as runtime app traffic.
 */
import 'dotenv/config';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'ERROR: DATABASE_URL must be set in .env. ' +
      'CLI scripts use the Supabase pooled connection (port 6543) for queries.'
  );
  process.exit(1);
}

const provider = new SupabaseDatabaseProvider(url);
export const db = provider.getConnection();

export async function close(): Promise<void> {
  await provider.close();
}
