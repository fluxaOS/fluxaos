import { resolveContext } from '@/lib/resolve-context';
import { DashboardClient } from './dashboard-client';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ org: string; user: string; project: string }>;
}) {
  const { org, user, project } = await params;
  const ctx = await resolveContext(org, user, project);

  return (
    <DashboardClient
      projectId={ctx.project.id}
      projectName={ctx.project.name}
      basePath={`/${org}/${user}/${project}`}
    />
  );
}
