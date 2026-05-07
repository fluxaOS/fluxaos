import { eq } from 'drizzle-orm';
import { event as eventTable, stageRun } from '@/core/db/schema';
import { close, db } from './connection';

async function main() {
  const runId = process.argv[2];
  if (!runId) {
    console.error('Usage: tsx run-detail.ts <runId>');
    process.exit(1);
  }

  const runs = await db
    .select()
    .from(stageRun)
    .where(eq(stageRun.pipelineRunId, runId));
  console.log('Stage runs:', JSON.stringify(runs, null, 2));

  const events = await db
    .select()
    .from(eventTable)
    .where(eq(eventTable.stageRunId, runs[0]?.id ?? ''));
  console.log('Events:', JSON.stringify(events, null, 2));

  await close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
