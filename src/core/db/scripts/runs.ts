/**
 * db:runs — list pipeline runs and their stage runs.
 *
 * Usage: npx tsx src/core/db/scripts/runs.ts
 */
import { db, close } from '@/core/db/scripts/connection';
import { eq } from 'drizzle-orm';
import { pipelineRun, stageRun } from '@/core/db/schema';

async function main() {
  const pipelineRuns = await db
    .select()
    .from(pipelineRun)
    .orderBy(pipelineRun.createdAt);

  if (pipelineRuns.length === 0) {
    console.log('No pipeline runs found.');
    await close();
    return;
  }

  for (const pr of pipelineRuns) {
    console.log(`Pipeline Run: ${pr.id}`);
    console.log(`  Status: ${pr.status}  Pipeline: ${pr.pipelineId}  Issue: ${pr.issueId ?? '–'}`);
    console.log(`  Started: ${pr.startedAt ?? '–'}  Completed: ${pr.completedAt ?? '–'}`);

    const stageRuns = await db
      .select()
      .from(stageRun)
      .where(eq(stageRun.pipelineRunId, pr.id))
      .orderBy(stageRun.createdAt);

    if (stageRuns.length === 0) {
      console.log('  (no stage runs)');
    } else {
      for (const sr of stageRuns) {
        console.log(`  Stage Run: ${sr.id}`);
        console.log(`    Status: ${sr.status}  Exit: ${sr.exitCode ?? '–'}  Trigger: ${sr.trigger}`);
        console.log(`    Signal: ${sr.skillSignal ?? '–'}  Metadata: ${sr.skillMetadata ? JSON.stringify(sr.skillMetadata) : '–'}`);
      }
    }
    console.log('');
  }

  console.log(`${pipelineRuns.length} pipeline run(s)`);
  await close();
}

main().catch((err) => {
  console.error('db:runs failed:', err);
  process.exit(1);
});
