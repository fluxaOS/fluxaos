import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createTRPCContext } from '@/server/trpc';
import { createIssueService } from '@/core/services';
import Link from 'next/link';
import IssueActions from './actions';

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const { db } = createTRPCContext();
  const svc = createIssueService(db);
  const issue = await svc.getById(id);
  if (!issue) notFound();

  const events = await svc.listEvents(id);

  return (
    <div className="min-h-screen bg-neutral-950 text-white p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="text-neutral-400 hover:text-white">← Back</Link>
        <h1 className="text-xl font-bold">{issue.title}</h1>
      </div>

      <div className="flex gap-2">
        <span className={`text-xs px-2 py-1 rounded ${
          issue.state === 'open' ? 'bg-green-900 text-green-300' :
          issue.state === 'in_progress' ? 'bg-blue-900 text-blue-300' :
          issue.state === 'closed' ? 'bg-neutral-700 text-neutral-300' :
          'bg-red-900 text-red-300'
        }`}>{issue.state}</span>
        <span className="text-xs px-2 py-1 rounded bg-neutral-800 text-neutral-300">{issue.priority}</span>
        <span className="text-xs px-2 py-1 rounded bg-neutral-800 text-neutral-300">{issue.type}</span>
      </div>

      {issue.description && (
        <p className="text-sm text-neutral-400">{issue.description}</p>
      )}

      <p className="text-xs text-neutral-600">
        Created {issue.createdAt?.toISOString()} · Source: {issue.source}
      </p>

      <IssueActions issueId={id} currentState={issue.state ?? 'open'} />

      {/* Comments / Events */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-neutral-300">Activity ({events.length})</h2>
        {events.length === 0 && (
          <p className="text-sm text-neutral-500">No activity yet.</p>
        )}
        {events.map(ev => (
          <div key={ev.id} className="rounded border border-neutral-800 bg-neutral-900 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-500">{ev.type}</span>
              <span className="text-xs text-neutral-600">{ev.timestamp?.toISOString()}</span>
            </div>
            <p className="text-sm mt-1">{JSON.stringify(ev.payload)}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
