import { eq } from 'drizzle-orm';
import { pipelineStage, stageRun } from '@/core/db/schema';
import { close, db } from '@/scripts/db/connection';

async function main() {
  const runs = await db
    .select({ sr: stageRun, ps: pipelineStage })
    .from(stageRun)
    .innerJoin(pipelineStage, eq(stageRun.pipelineStageId, pipelineStage.id));
  for (const r of runs) {
    console.log(
      r.sr.pipelineRunId,
      '|',
      r.ps.name,
      '|',
      r.sr.status,
      '|',
      r.sr.trigger,
      '|',
      r.sr.skillSignal
    );
  }
  await close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
