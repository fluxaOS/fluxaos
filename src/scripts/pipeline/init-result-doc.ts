import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  issue,
  organization,
  pipeline,
  pipelineRun,
  pipelineStage,
  project,
  stageRun,
} from '@/core/db/schema';
import { close, db } from '@/scripts/db/connection';

async function main() {
  const args = process.argv.slice(2);
  const stageRunIdIdx = args.indexOf('--stage-run-id');
  const outputIdx = args.indexOf('--output');

  if (stageRunIdIdx === -1 || outputIdx === -1) {
    console.error(
      'Usage: init-result-doc.ts --stage-run-id <uuid> --output <path>'
    );
    await close();
    process.exit(1);
  }

  const stageRunId = args[stageRunIdIdx + 1];
  const outputPath = args[outputIdx + 1];

  const [sRun] = await db
    .select()
    .from(stageRun)
    .where(eq(stageRun.id, stageRunId));
  if (!sRun) {
    console.error(`stage_run not found: ${stageRunId}`);
    await close();
    process.exit(1);
  }

  const [run] = await db
    .select()
    .from(pipelineRun)
    .where(eq(pipelineRun.id, sRun.pipelineRunId));
  if (!run) {
    console.error(`pipeline_run not found: ${sRun.pipelineRunId}`);
    await close();
    process.exit(1);
  }

  const [stage] = await db
    .select()
    .from(pipelineStage)
    .where(eq(pipelineStage.id, sRun.pipelineStageId));
  if (!stage) {
    console.error(`pipeline_stage not found: ${sRun.pipelineStageId}`);
    await close();
    process.exit(1);
  }

  const [pl] = await db
    .select()
    .from(pipeline)
    .where(eq(pipeline.id, run.pipelineId));
  if (!pl) {
    console.error(`pipeline not found: ${run.pipelineId}`);
    await close();
    process.exit(1);
  }

  const [proj] = await db
    .select()
    .from(project)
    .where(eq(project.id, pl.projectId));
  if (!proj) {
    console.error(`project not found: ${pl.projectId}`);
    await close();
    process.exit(1);
  }

  const [orgRow] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, proj.orgId));
  if (!orgRow) {
    console.error(`organization not found: ${proj.orgId}`);
    await close();
    process.exit(1);
  }

  let issueContext = { id: '', number: 0, title: '' };
  if (run.issueId) {
    const [iss] = await db
      .select()
      .from(issue)
      .where(eq(issue.id, run.issueId));
    if (iss)
      issueContext = { id: iss.id, number: iss.number, title: iss.title };
  }

  // Idempotency: if result doc already has a valid verdict, skip init and write existing
  if (sRun.resultDoc && typeof sRun.resultDoc === 'object') {
    const existing = sRun.resultDoc as Record<string, unknown>;
    if (
      existing.verdict &&
      ['pass', 'fail', 'blocked'].includes(existing.verdict as string)
    ) {
      console.log(
        `result doc already has verdict '${existing.verdict}' — skipping init`
      );
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, JSON.stringify(existing, null, 2));
      await close();
      return;
    }
  }

  const partial = {
    issue: issueContext,
    run: {
      pipelineRunId: run.id,
      stageRunId: sRun.id,
      stage: stage.name,
      attempt: sRun.attempt,
    },
    org: { id: orgRow.id },
    project: { id: proj.id },
    timing: { startedAt: new Date().toISOString() },
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(partial, null, 2));
  console.log(`result doc initialized: ${outputPath}`);

  await close();
}

main().catch(async (err) => {
  console.error(err);
  await close();
  process.exit(1);
});
