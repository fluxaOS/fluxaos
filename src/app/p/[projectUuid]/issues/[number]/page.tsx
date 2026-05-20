import { resolveContext } from '@/lib/resolve-context';
import { IssueDetailClient } from './client';

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{
    org: string;
    user: string;
    project: string;
    number: string;
  }>;
}) {
  const { org, user, project, number } = await params;
  const ctx = await resolveContext(org, user, project);

  return (
    <IssueDetailClient
      projectId={ctx.project.id}
      issueNumber={parseInt(number, 10)}
      basePath={`/${org}/${user}/${project}`}
    />
  );
}
