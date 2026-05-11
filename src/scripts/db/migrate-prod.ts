import { join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

if (process.env.NODE_ENV !== 'production') {
  loadDotenv({
    path: join(process.cwd(), '.env'),
    override: false,
    quiet: true,
  });
  loadDotenv({
    path: join(process.cwd(), '.env.local'),
    override: false,
    quiet: true,
  });
}

// Migrations issue DDL (CREATE TABLE, ALTER, etc.). pgbouncer transaction
// mode (DATABASE_URL on port 6543) breaks DDL — every statement may land on
// a different backend, so prepared-statement caches and session-scoped
// objects (search_path, locks) are unreliable. Require the direct/session
// connection on port 5432.
const url = process.env.DIRECT_URL;

if (!url) {
  throw new Error(
    'DIRECT_URL is required for migrations. ' +
      'Set DIRECT_URL to your Supabase direct connection (port 5432). ' +
      'DATABASE_URL (pgbouncer transaction mode) is not acceptable for DDL.'
  );
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);

try {
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('migrations applied');
} finally {
  await client.end();
}
