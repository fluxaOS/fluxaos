import { projectBasePath } from '@/lib/project-url';
import { resolveContext } from '@/lib/resolve-context';
import { IssueCreateClient } from './client';

export default async function IssueCreatePage({
  params,
}: {
  params: Promise<{ projectUuid: string }>;
}) {
  const { projectUuid } = await params;
  const ctx = await resolveContext(projectUuid);

  return (
    <IssueCreateClient
      projectId={ctx.project.id}
      basePath={projectBasePath(ctx.project.id)}
    />
  );
}
