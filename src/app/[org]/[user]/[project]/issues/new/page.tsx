import { resolveContext } from '@/lib/resolve-context';
import { IssueCreateClient } from './client';

export default async function IssueCreatePage({
  params,
}: {
  params: Promise<{ org: string; user: string; project: string }>;
}) {
  const { org, user, project } = await params;
  const ctx = await resolveContext(org, user, project);

  return (
    <IssueCreateClient
      projectId={ctx.project.id}
      basePath={`/${org}/${user}/${project}`}
    />
  );
}
