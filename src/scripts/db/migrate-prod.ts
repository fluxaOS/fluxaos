import { join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

loadDotenv({ path: join(process.cwd(), '.env'), override: false, quiet: true });
loadDotenv({
  path: join(process.cwd(), '.env.local'),
  override: false,
  quiet: true,
});

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'DIRECT_URL or DATABASE_URL is required for migrations. ' +
      'Set DIRECT_URL to your Supabase direct connection (port 5432).'
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
