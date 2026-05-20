import { resolveContext } from '@/lib/resolve-context';
import { IssueListClient } from './client';

export default async function IssuesPage({
  params,
}: {
  params: Promise<{ org: string; user: string; project: string }>;
}) {
  const { org, user, project } = await params;
  const ctx = await resolveContext(org, user, project);

  return (
    <IssueListClient
      projectId={ctx.project.id}
      basePath={`/${org}/${user}/${project}`}
    />
  );
}
