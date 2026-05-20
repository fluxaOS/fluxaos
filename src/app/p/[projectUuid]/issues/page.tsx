import { projectBasePath } from '@/lib/project-url';
import { resolveContext } from '@/lib/resolve-context';
import { IssueListClient } from './client';

export default async function IssuesPage({
  params,
}: {
  params: Promise<{ projectUuid: string }>;
}) {
  const { projectUuid } = await params;
  const ctx = await resolveContext(projectUuid);

  return (
    <IssueListClient
      projectId={ctx.project.id}
      basePath={projectBasePath(ctx.project.id)}
    />
  );
}
