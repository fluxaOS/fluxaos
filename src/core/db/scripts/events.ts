/**
 * db:events — list events.
 *
 * Usage:
 *   npx tsx src/core/db/scripts/events.ts             # 50 most recent events
 *   npx tsx src/core/db/scripts/events.ts --run <uuid> # filter by stageRunId
 *   npx tsx src/core/db/scripts/events.ts --issue <uuid> # issue events
 */
import { db, close } from '@/core/db/scripts/connection';
import { desc, eq } from 'drizzle-orm';
import { event, issueEvent } from '@/core/db/schema';

function parseArgs(): { mode: 'recent' | 'run' | 'issue'; id?: string } {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run' && args[i + 1]) {
      return { mode: 'run', id: args[i + 1] };
    }
    if (args[i] === '--issue' && args[i + 1]) {
      return { mode: 'issue', id: args[i + 1] };
    }
  }
  return { mode: 'recent' };
}

async function main() {
  const { mode, id } = parseArgs();

  if (mode === 'issue') {
    const rows = await db
      .select()
      .from(issueEvent)
      .where(eq(issueEvent.issueId, id!))
      .orderBy(desc(issueEvent.timestamp));

    if (rows.length === 0) {
      console.log('No issue events found.');
    } else {
      for (const row of rows) {
        console.log(`[${row.timestamp.toISOString()}] ${row.type} by ${row.actor}`);
        if (row.payload) console.log(`  ${JSON.stringify(row.payload)}`);
      }
      console.log(`\n${rows.length} issue event(s)`);
    }
  } else {
    let query = db
      .select()
      .from(event)
      .orderBy(desc(event.timestamp))
      .limit(50);

    if (mode === 'run') {
      query = db
        .select()
        .from(event)
        .where(eq(event.stageRunId, id!))
        .orderBy(desc(event.timestamp));
    }

    const rows = await query;

    if (rows.length === 0) {
      console.log('No events found.');
    } else {
      for (const row of rows) {
        console.log(`[${row.timestamp.toISOString()}] ${row.type}  run=${row.stageRunId}`);
        if (row.payload) console.log(`  ${JSON.stringify(row.payload)}`);
      }
      console.log(`\n${rows.length} event(s)`);
    }
  }

  await close();
}

main().catch((err) => {
  console.error('db:events failed:', err);
  process.exit(1);
});
