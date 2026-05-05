import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';

async function main() {
  const provider = new SupabaseDatabaseProvider(process.env.DATABASE_URL!);
  const db = provider.getConnection();
  const orgs = (await db.execute(
    sql`SELECT slug FROM organization ORDER BY created_at`
  )) as { slug: string }[];
  const users = (await db.execute(
    sql`SELECT slug FROM "user" ORDER BY created_at`
  )) as { slug: string }[];
  const projects = (await db.execute(
    sql`SELECT slug FROM project ORDER BY created_at`
  )) as { slug: string }[];
  console.log(
    'orgs:',
    orgs.map((r) => r.slug)
  );
  console.log(
    'users:',
    users.map((r) => r.slug)
  );
  console.log(
    'projects:',
    projects.map((r) => r.slug)
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
