import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createTRPCContext } from '@/server/trpc';
import { createOrganizationService, createProjectService, createPipelineService, createIssueService } from '@/core/services';
import Link from 'next/link';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { db } = createTRPCContext();
  const orgs = await createOrganizationService(db).list();
  const org = orgs[0];
  if (!org) return <div className="p-8 text-white">No organization found. Run the seed script.</div>;

  const projects = await createProjectService(db).listByOrg(org.id);
  const project = projects[0];

  const pipelines = project ? await createPipelineService(db).listByProject(project.id) : [];
  const issues = project ? await createIssueService(db).listByProject(project.id) : [];

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-8 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">fluxaOS Dashboard</h1>
        <div className="text-sm text-neutral-400">{user.email}</div>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-neutral-300">Organization</h2>
        <p className="text-sm text-neutral-400">{org.name} ({org.slug})</p>
      </section>

      {project && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-neutral-300">Project</h2>
          <p className="text-sm text-neutral-400">{project.name} — {project.repoUrl}</p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-300">Pipelines ({pipelines.length})</h2>
        {pipelines.map(p => (
          <div key={p.id} className="rounded border border-neutral-800 bg-neutral-900 p-3">
            <p className="font-medium">{p.name}</p>
            <p className="text-xs text-neutral-500">{p.description}</p>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-neutral-300">Issues ({issues.length})</h2>
          <Link href="/dashboard/issues/new" className="text-sm bg-blue-600 px-3 py-1 rounded hover:bg-blue-500">
            New Issue
          </Link>
        </div>
        {issues.length === 0 && (
          <p className="text-sm text-neutral-500">No issues yet. Create one to test CRUD.</p>
        )}
        {issues.map(i => (
          <Link key={i.id} href={`/dashboard/issues/${i.id}`} className="block rounded border border-neutral-800 bg-neutral-900 p-3 hover:border-neutral-600">
            <div className="flex items-center gap-2">
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
            <p className="font-medium mt-1">{i.title}</p>
            {i.description && <p className="text-xs text-neutral-500 mt-1">{i.description}</p>}
          </Link>
        ))}
      </section>

      <nav className="pt-4 border-t border-neutral-800 flex gap-4 text-sm">
        <Link href="/dashboard/issues/new" className="text-blue-400 hover:underline">Create Issue</Link>
        <Link href="/dashboard/settings" className="text-blue-400 hover:underline">Settings</Link>
        <form action="/auth/signout" method="post">
          <button className="text-neutral-400 hover:text-white">Sign Out</button>
        </form>
      </nav>
    </div>
  );
}
