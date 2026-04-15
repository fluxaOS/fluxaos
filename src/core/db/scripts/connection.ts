/**
 * Shared DB connection helper for CLI scripts.
 *
 * Usage:
 *   import { db, close } from '@/core/db/scripts/connection';
 *   // ... query db ...
 *   await close();
 */
import 'dotenv/config';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DIRECT_URL or DATABASE_URL must be set in .env');
  process.exit(1);
}

const provider = new SupabaseDatabaseProvider(url);
export const db = provider.getConnection();

export async function close(): Promise<void> {
  await provider.close();
}
