/**
 * Seed verification — asserts expected state after nuke + seed.
 *
 * Usage: npx tsx tests/verify/seed-check.ts
 */

import { eq } from 'drizzle-orm';
import {
  driver,
  issue,
  issueState,
  issueStatus,
  pipelineStage,
  skill,
} from '@/core/db/schema';
import { close, db } from '@/scripts/db/connection';

let failures = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  PASS  ${message}`);
  } else {
    console.log(`  FAIL  ${message}`);
    failures++;
  }
}

async function main() {
  console.log('Seed verification\n');

  // --- Issues ---
  const issues = await db
    .select({
      number: issue.number,
      title: issue.title,
      stateKey: issueState.key,
      statusKey: issueStatus.key,
      isClosed: issue.isClosed,
    })
    .from(issue)
    .leftJoin(issueState, eq(issue.stateId, issueState.id))
    .leftJoin(issueStatus, eq(issue.statusId, issueStatus.id))
    .orderBy(issue.number);

  assert(issues.length === 2, `2 issues exist (got ${issues.length})`);

  const i1 = issues.find((i) => i.number === 1);
  const i2 = issues.find((i) => i.number === 2);

  if (i1) {
    assert(
      i1.stateKey === 'research',
      `Issue #1 state=research (got ${i1.stateKey})`
    );
    assert(
      i1.statusKey === 'open',
      `Issue #1 status=open (got ${i1.statusKey})`
    );
    assert(i1.isClosed === false, `Issue #1 not closed (got ${i1.isClosed})`);
  } else {
    console.log('  FAIL  Issue #1 not found');
    failures++;
  }

  if (i2) {
    assert(
      i2.stateKey === 'research',
      `Issue #2 state=research (got ${i2.stateKey})`
    );
    assert(
      i2.statusKey === 'open',
      `Issue #2 status=open (got ${i2.statusKey})`
    );
    assert(i2.isClosed === false, `Issue #2 not closed (got ${i2.isClosed})`);
  } else {
    console.log('  FAIL  Issue #2 not found');
    failures++;
  }

  // --- Pipeline stages ---
  const stages = await db.select().from(pipelineStage);
  assert(stages.length === 3, `3 pipeline stages (got ${stages.length})`);

  // --- Skills ---
  const skills = await db.select().from(skill);
  assert(skills.length === 4, `4 skills (got ${skills.length})`);

  // --- Drivers ---
  // FLX-6: seed adds the OpenAI Codex CLI driver alongside Claude Code.
  const drivers = await db.select().from(driver);
  assert(drivers.length === 2, `2 drivers (got ${drivers.length})`);
  const driverSlugs = drivers.map((d) => d.slug).sort();
  assert(
    driverSlugs.join(',') === 'claude-code,openai-codex',
    `seeded driver slugs (got ${driverSlugs.join(',')})`
  );

  // --- Summary ---
  console.log('');
  if (failures === 0) {
    console.log('All checks passed.');
  } else {
    console.log(`${failures} check(s) failed.`);
    await close();
    process.exit(1);
  }

  await close();
}

main().catch((err) => {
  console.error('Seed check failed:', err);
  process.exit(1);
});
