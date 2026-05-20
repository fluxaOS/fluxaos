import { projectBasePath } from '@/lib/project-url';
import { resolveContext } from '@/lib/resolve-context';
import { IssueDetailClient } from './client';

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{
    projectUuid: string;
    number: string;
  }>;
}) {
  const { projectUuid, number } = await params;
  const ctx = await resolveContext(projectUuid);

  return (
    <IssueDetailClient
      projectId={ctx.project.id}
      issueNumber={parseInt(number, 10)}
      basePath={projectBasePath(ctx.project.id)}
    />
  );
}
