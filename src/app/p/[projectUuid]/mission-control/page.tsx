import { projectBasePath } from '@/lib/project-url';
import { resolveContext } from '@/lib/resolve-context';
import { MissionControlClient } from './client';

export default async function MissionControlPage({
  params,
}: {
  params: Promise<{ projectUuid: string }>;
}) {
  const { projectUuid } = await params;
  const ctx = await resolveContext(projectUuid);

  return (
    <MissionControlClient
      projectId={ctx.project.id}
      projectName={ctx.project.name}
      basePath={projectBasePath(ctx.project.id)}
    />
  );
}
