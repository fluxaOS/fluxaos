import { redirect } from 'next/navigation';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import { organization, project } from '@/core/db/schema';
import type { DatabaseProvider } from '@/core/ports/database';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  bootstrap();
  const db = registry.get<DatabaseProvider>('database').getConnection();

  const [org] = await db.select().from(organization).limit(1);
  if (!org) {
    return (
      <div className="flex items-center justify-center min-h-screen text-slate-400">
        <p>No organization found. Run: npx tsx src/scripts/db/seed.ts</p>
      </div>
    );
  }

  const [proj] = await db.select().from(project).limit(1);
  if (!proj) {
    return (
      <div className="flex items-center justify-center min-h-screen text-slate-400">
        <p>No project found. Run: npx tsx src/scripts/db/seed.ts</p>
      </div>
    );
  }

  redirect(`/p/${proj.id}`);
}
