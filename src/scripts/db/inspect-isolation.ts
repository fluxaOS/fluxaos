import { eq } from 'drizzle-orm';
import { isolationEnvironment } from '@/core/db/schema';
import { close, db } from '@/scripts/db/connection';

async function main() {
  const targetRunId = process.argv[2];
  const rows = targetRunId
    ? await db
        .select()
        .from(isolationEnvironment)
        .where(eq(isolationEnvironment.runId, targetRunId))
    : await db.select().from(isolationEnvironment).limit(20);
  for (const r of rows) {
    console.log(
      `${r.id} | run=${r.runId} | status=${r.status} | path=${r.workingPath} | created=${r.createdAt}`
    );
  }
  await close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
