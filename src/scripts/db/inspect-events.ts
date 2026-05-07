import { desc, eq } from 'drizzle-orm';
import { event, stageRun } from '@/core/db/schema';
import { close, db } from '@/scripts/db/connection';

async function main() {
  const targetRunId = process.argv[2];
  if (!targetRunId) {
    console.error('usage: inspect-events.ts <pipelineRunId>');
    process.exit(1);
  }
  const stageRuns = await db
    .select()
    .from(stageRun)
    .where(eq(stageRun.pipelineRunId, targetRunId));
  for (const sr of stageRuns) {
    const events = await db
      .select()
      .from(event)
      .where(eq(event.stageRunId, sr.id))
      .orderBy(desc(event.createdAt))
      .limit(20);
    console.log(`\n=== stage_run ${sr.id} (status=${sr.status}) ===`);
    for (const ev of events) {
      console.log(
        `  ${ev.createdAt} | ${ev.type} | ${JSON.stringify(ev.payload).slice(0, 300)}`
      );
    }
  }
  await close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
