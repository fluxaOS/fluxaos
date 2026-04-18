/**
 * db:issues — list issues with joined state, status, priority, type.
 *
 * Usage: npx tsx src/scripts/db/issues.ts
 */
import { db, close } from '@/scripts/db/connection';
import { eq } from 'drizzle-orm';
import {
  issue,
  issueState,
  issueStatus,
  issuePriority,
  issueType,
} from '@/core/db/schema';

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

async function main() {
  const rows = await db
    .select({
      number: issue.number,
      title: issue.title,
      state: issueState.displayName,
      status: issueStatus.displayName,
      priority: issuePriority.displayName,
      type: issueType.displayName,
      isClosed: issue.isClosed,
    })
    .from(issue)
    .leftJoin(issueState, eq(issue.stateId, issueState.id))
    .leftJoin(issueStatus, eq(issue.statusId, issueStatus.id))
    .leftJoin(issuePriority, eq(issue.priorityId, issuePriority.id))
    .leftJoin(issueType, eq(issue.typeId, issueType.id))
    .orderBy(issue.number);

  if (rows.length === 0) {
    console.log('No issues found.');
    await close();
    return;
  }

  // Header
  const header = [
    pad('#', 5),
    pad('Title', 52),
    pad('State', 14),
    pad('Status', 12),
    pad('Priority', 12),
    pad('Type', 12),
    pad('Closed', 6),
  ].join('  ');

  console.log(header);
  console.log('-'.repeat(header.length));

  for (const row of rows) {
    console.log(
      [
        pad(String(row.number), 5),
        pad(truncate(row.title, 50), 52),
        pad(row.state ?? '–', 14),
        pad(row.status ?? '–', 12),
        pad(row.priority ?? '–', 12),
        pad(row.type ?? '–', 12),
        pad(row.isClosed ? 'yes' : 'no', 6),
      ].join('  '),
    );
  }

  console.log(`\n${rows.length} issue(s)`);
  await close();
}

main().catch((err) => {
  console.error('db:issues failed:', err);
  process.exit(1);
});
