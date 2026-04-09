/**
 * Supabase DatabaseProvider adapter.
 *
 * Creates the Drizzle connection to Supabase Postgres.
 * Implements the DatabaseProvider port interface.
 *
 * Vendor imports (postgres, drizzle-orm/postgres-js) live HERE,
 * not in core/. Core only imports the Database type.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '@/core/db/schema';
import type { DatabaseProvider } from '@/core/ports/database';
import type { Database } from '@/core/db/connection';

export class SupabaseDatabaseProvider implements DatabaseProvider {
  private db: Database;

  constructor(connectionString: string) {
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is required. Set it to your Supabase transaction pooler URL (port 6543).',
      );
    }
    const client = postgres(connectionString, { prepare: false });
    this.db = drizzle({ client, schema });
  }

  getConnection(): Database {
    return this.db;
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.db.execute(sql`SELECT 1`);
      return true;
    } catch {
      return false;
    }
  }
}
