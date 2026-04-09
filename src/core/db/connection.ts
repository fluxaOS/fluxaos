/**
 * Database connection factory for Supabase Postgres.
 *
 * Uses postgres-js driver with prepare: false for Supabase transaction pooler.
 * This file exports a factory — NOT a singleton. The adapter registry calls
 * createDatabase() once at startup and passes the result to services via DI.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export function createDatabase(connectionString: string): Database {
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required. Set it to your Supabase transaction pooler URL (port 6543).',
    );
  }

  const client = postgres(connectionString, { prepare: false });
  return drizzle({ client, schema });
}
