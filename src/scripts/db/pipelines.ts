import { pipeline, pipelineStage } from '@/core/db/schema';
import { close, db } from './connection';

async function main() {
  const pipelines = await db.select().from(pipeline).limit(10);
  console.log('Pipelines:');
  for (const p of pipelines) {
    console.log(`  [${p.id}] ${p.name} (project: ${p.projectId})`);
  }
  const stages = await db.select().from(pipelineStage).limit(30);
  console.log('\nStages:');
  for (const s of stages) {
    console.log(
      `  [${s.id}] ${s.name} | pipeline: ${s.pipelineId} | onPass: ${s.onPass} | onFail: ${s.onFail} | fallback: ${s.fallback}`
    );
  }
  await close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
