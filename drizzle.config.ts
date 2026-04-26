import { defineConfig } from 'drizzle-kit';

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'DIRECT_URL or DATABASE_URL is required for migrations. ' +
      'Set DIRECT_URL to your Supabase direct connection (port 5432).'
  );
}

export default defineConfig({
  schema: './src/core/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
});
