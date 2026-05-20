import { projectBasePath } from '@/lib/project-url';
import { resolveContext } from '@/lib/resolve-context';
import { DashboardClient } from './dashboard-client';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ projectUuid: string }>;
}) {
  const { projectUuid } = await params;
  const ctx = await resolveContext(projectUuid);

  return (
    <DashboardClient
      projectId={ctx.project.id}
      projectName={ctx.project.name}
      basePath={projectBasePath(ctx.project.id)}
    />
  );
}
