/**
 * db:events — list events.
 *
 * Usage:
 *   npx tsx src/scripts/db/events.ts             # 50 most recent events
 *   npx tsx src/scripts/db/events.ts --run <uuid> # filter by stageRunId
 *   npx tsx src/scripts/db/events.ts --issue <uuid> # issue events
 */

import { desc, eq } from 'drizzle-orm';
import { event, issueEvent } from '@/core/db/schema';
import { close, db } from '@/scripts/db/connection';

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
        console.log(
          `[${row.timestamp.toISOString()}] ${row.type} by ${row.actor}`
        );
        if (row.payload) console.log(`  ${JSON.stringify(row.payload)}`);
      }
      console.log(`\n${rows.length} issue event(s)`);
    }
  } else {
    // Build query by mode — same terminal shape in both branches.
    // The 'run' branch intentionally omits the limit (surfaces all events for a run).
    const rows =
      mode === 'run'
        ? await db
            .select()
            .from(event)
            .where(eq(event.stageRunId, id!))
            .orderBy(desc(event.timestamp))
        : await db
            .select()
            .from(event)
            .orderBy(desc(event.timestamp))
            .limit(50);

    if (rows.length === 0) {
      console.log('No events found.');
    } else {
      for (const row of rows) {
        console.log(
          `[${row.timestamp.toISOString()}] ${row.type}  run=${row.stageRunId}`
        );
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
