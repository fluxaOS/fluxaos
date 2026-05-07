import { project } from '@/core/db/schema';
import { close, db } from './connection';

async function main() {
  const projects = await db
    .select({
      id: project.id,
      name: project.name,
      defaultPipelineId: project.defaultPipelineId,
    })
    .from(project)
    .limit(5);
  console.log(JSON.stringify(projects, null, 2));
  await close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
