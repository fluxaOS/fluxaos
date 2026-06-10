import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';

async function main() {
  const provider = new SupabaseDatabaseProvider(process.env.DATABASE_URL!);
  const db = provider.getConnection();
  const orgs = (await db.execute(
    sql`SELECT id, name FROM organization ORDER BY created_at`
  )) as { id: string; name: string }[];
  const users = (await db.execute(
    sql`SELECT id, name FROM "user" ORDER BY created_at`
  )) as { id: string; name: string }[];
  const projects = (await db.execute(
    sql`SELECT id, name FROM project ORDER BY created_at`
  )) as { id: string; name: string }[];
  console.log(
    'orgs:',
    orgs.map((r) => `${r.name} (${r.id})`)
  );
  console.log(
    'users:',
    users.map((r) => `${r.name} (${r.id})`)
  );
  console.log(
    'projects:',
    projects.map((r) => `${r.name} (${r.id})`)
  );
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
