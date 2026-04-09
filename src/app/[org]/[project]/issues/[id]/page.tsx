import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveContext } from '@/lib/resolve-context';
import { createIssueService, createPipelineService } from '@/core/services';
import Link from 'next/link';
import IssueActions from './actions';

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ org: string; project: string; id: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { org: orgSlug, project: projectSlug, id } = await params;
  const { db, org, project } = await resolveContext(orgSlug, projectSlug);

  const issueSvc = createIssueService(db);
  const issue = await issueSvc.getById(id);
  if (!issue) notFound();

  const events = await issueSvc.listEvents(id);

  // Get pipeline stages for this project
  const pipeSvc = createPipelineService(db);
  const pipelines = await pipeSvc.listByProject(project.id);
  const defaultPipeline = pipelines.find(p => p.isDefault) ?? pipelines[0];
  const stages = defaultPipeline
    ? await pipeSvc.stages.listByPipeline(defaultPipeline.id)
    : [];

  const base = `/${org.slug}/${project.slug}`;

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-8 max-w-4xl mx-auto space-y-6">
      <Link href={base} className="text-sm text-neutral-400 hover:text-white">
        ← {project.name}
      </Link>

      <IssueActions
        issueId={id}
        issue={{
          title: issue.title,
          description: issue.description ?? '',
          state: issue.state ?? 'open',
          priority: issue.priority ?? 'medium',
          type: issue.type ?? 'task',
          source: issue.source ?? 'internal',
          createdAt: issue.createdAt?.toISOString() ?? '',
        }}
        events={events.map(ev => ({
          id: ev.id,
          type: ev.type,
          payload: ev.payload as Record<string, unknown>,
          timestamp: ev.timestamp?.toISOString() ?? '',
        }))}
        stages={stages.map(s => ({
          id: s.id,
          name: s.name,
          sortOrder: s.sortOrder,
          gateMode: s.gateMode ?? 'auto',
        }))}
        userEmail={user.email ?? 'unknown'}
        basePath={base}
      />
    </div>
  );
}
