import { resolveContext } from '@/lib/resolve-context';
import { MissionControlClient } from './client';

export default async function MissionControlPage({
  params,
}: {
  params: Promise<{ org: string; user: string; project: string }>;
}) {
  const { org, user, project } = await params;
  const ctx = await resolveContext(org, user, project);

  return (
    <MissionControlClient
      projectId={ctx.project.id}
      projectName={ctx.project.name}
      basePath={`/${org}/${user}/${project}`}
    />
  );
}
