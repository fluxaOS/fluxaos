/**
 * db:gates — list stage gate results.
 *
 * Usage: npx tsx src/scripts/db/gates.ts
 */
import { db, close } from '@/scripts/db/connection';
import { stageGateResult } from '@/core/db/schema';

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

async function main() {
  const rows = await db
    .select()
    .from(stageGateResult)
    .orderBy(stageGateResult.createdAt);

  if (rows.length === 0) {
    console.log('No gate results found.');
    await close();
    return;
  }

  const header = [
    pad('Stage Run ID', 38),
    pad('Verdict', 12),
    pad('Passed', 8),
    pad('Reason', 60),
  ].join('  ');

  console.log(header);
  console.log('-'.repeat(header.length));

  for (const row of rows) {
    console.log(
      [
        pad(row.stageRunId, 38),
        pad(row.verdict, 12),
        pad(row.passed ? 'yes' : 'no', 8),
        pad(row.reason.length > 60 ? row.reason.slice(0, 59) + '…' : row.reason, 60),
      ].join('  '),
    );
  }

  console.log(`\n${rows.length} gate result(s)`);
  await close();
}

main().catch((err) => {
  console.error('db:gates failed:', err);
  process.exit(1);
});
