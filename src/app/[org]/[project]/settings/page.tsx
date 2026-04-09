import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveContext } from '@/lib/resolve-context';
import { createPipelineService } from '@/core/services';
import Link from 'next/link';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { org: orgSlug, project: projectSlug } = await params;
  const { db, org, project } = await resolveContext(orgSlug, projectSlug);

  const pipeSvc = createPipelineService(db);
  const pipelines = await pipeSvc.listByProject(project.id);
  const defaultPipeline = pipelines.find(p => p.isDefault) ?? pipelines[0];
  const stages = defaultPipeline
    ? await pipeSvc.stages.listByPipeline(defaultPipeline.id)
    : [];

  const base = `/${org.slug}/${project.slug}`;

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-8 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-4">
        <Link href={base} className="text-neutral-400 hover:text-white">← Back</Link>
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      <p className="text-sm text-neutral-500">
        Organization: {org.name} ({org.slug}) · Project: {project.name} ({project.slug})
      </p>

      {/* Pipeline stages from DB */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-300">
          Pipeline: {defaultPipeline?.name ?? 'None'}
        </h2>
        <p className="text-sm text-neutral-500">
          These stages come from the database and are configurable per project.
        </p>
        <div className="space-y-2">
          {stages.map(s => (
            <div key={s.id} className="rounded border border-neutral-800 bg-neutral-900 p-3 flex items-center gap-4">
              <span className="text-sm font-mono text-neutral-500 w-8">{s.sortOrder}</span>
              <span className="font-medium flex-1">{s.name}</span>
              <span className="text-xs text-neutral-500">gate: {s.gateMode}</span>
              <span className="text-xs text-neutral-500">harness: {s.harness ?? '—'}</span>
              <span className="text-xs text-neutral-500">timeout: {s.timeoutSec}s</span>
            </div>
          ))}
        </div>
      </section>

      <p className="text-sm text-neutral-600 italic">
        Full settings CRUD (add/edit/delete stages, personas, skills, routing, etc.) comes in the next iteration.
      </p>
    </div>
  );
}
