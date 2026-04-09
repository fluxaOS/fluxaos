import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveContext } from '@/lib/resolve-context';
import { createPipelineService, createIssueService } from '@/core/services';
import Link from 'next/link';

export default async function ProjectDashboard({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { org: orgSlug, project: projectSlug } = await params;
  const { db, org, project } = await resolveContext(orgSlug, projectSlug);

  const pipelines = await createPipelineService(db).listByProject(project.id);
  const issues = await createIssueService(db).listByProject(project.id);

  const base = `/${org.slug}/${project.slug}`;

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-sm text-neutral-500">{org.name} / {project.slug}</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-neutral-400">{user.email}</span>
          <form action="/auth/signout" method="post">
            <button className="text-neutral-500 hover:text-white">Sign Out</button>
          </form>
        </div>
      </div>

      {/* Pipelines */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-300">Pipelines ({pipelines.length})</h2>
        {pipelines.map(p => (
          <div key={p.id} className="rounded border border-neutral-800 bg-neutral-900 p-4">
            <div className="flex items-center gap-2">
              <p className="font-medium">{p.name}</p>
              {p.isDefault && <span className="text-xs bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">default</span>}
            </div>
            <p className="text-sm text-neutral-500 mt-1">{p.description}</p>
          </div>
        ))}
      </section>

      {/* Issues */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-300">Issues ({issues.length})</h2>
          <Link href={`${base}/issues/new`} className="text-sm bg-blue-600 px-3 py-1.5 rounded hover:bg-blue-500">
            New Issue
          </Link>
        </div>
        {issues.length === 0 && (
          <p className="text-sm text-neutral-500">No issues yet.</p>
        )}
        {issues.map(i => (
          <Link key={i.id} href={`${base}/issues/${i.id}`} className="block rounded border border-neutral-800 bg-neutral-900 p-4 hover:border-neutral-600 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                i.state === 'open' ? 'bg-green-900 text-green-300' :
                i.state === 'in_progress' ? 'bg-blue-900 text-blue-300' :
                i.state === 'closed' ? 'bg-neutral-700 text-neutral-300' :
                'bg-red-900 text-red-300'
              }`}>{i.state}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                i.priority === 'critical' ? 'bg-red-900 text-red-300' :
                i.priority === 'high' ? 'bg-orange-900 text-orange-300' :
                'bg-neutral-700 text-neutral-400'
              }`}>{i.priority}</span>
              <span className="text-xs text-neutral-500">{i.type}</span>
            </div>
            <p className="font-medium">{i.title}</p>
            {i.description && <p className="text-sm text-neutral-500 mt-1 line-clamp-2">{i.description}</p>}
          </Link>
        ))}
      </section>

      {/* Nav */}
      <nav className="pt-4 border-t border-neutral-800 flex gap-4 text-sm">
        <Link href={`${base}/issues`} className="text-blue-400 hover:underline">All Issues</Link>
        <Link href={`${base}/settings`} className="text-blue-400 hover:underline">Settings</Link>
      </nav>
    </div>
  );
}
