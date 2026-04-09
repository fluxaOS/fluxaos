import { redirect } from 'next/navigation';

export default async function IssuesPage({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const { org, project } = await params;
  // For now, redirect to the project dashboard which shows issues
  redirect(`/${org}/${project}`);
}
