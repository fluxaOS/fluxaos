'use client';

import Link from 'next/link';
import { use } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Card } from '@/components/card';
import { StatusBadge } from '@/components/status-badge';
import { trpc } from '@/lib/trpc/client';

function useBasePath() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  return segments.length >= 3 ? `/${segments[0]}/${segments[1]}/${segments[2]}` : '/';
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  open: ['in_progress', 'blocked', 'closed'],
  in_progress: ['open', 'blocked', 'closed'],
  blocked: ['open', 'in_progress'],
  closed: ['open'],
};

export default function IssueDetailPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = use(params);
  const basePath = useBasePath();
  // TODO: switch to getByNumber lookup in Task 5.2+
  const id = number;
  const issueQuery = trpc.issue.getById.useQuery({ id });
  const eventsQuery = trpc.issue.events.useQuery({ issueId: id });

  const transitionMutation = trpc.issue.transition.useMutation({
    onSuccess: () => {
      issueQuery.refetch();
      eventsQuery.refetch();
    },
  });

  const issue = issueQuery.data;
  const events = eventsQuery.data ?? [];

  if (issueQuery.isLoading) {
    return <div className="text-slate-500 py-8 text-center">Loading...</div>;
  }

  if (!issue) {
    return <div className="text-slate-500 py-8 text-center">Issue not found</div>;
  }

  const transitions = VALID_TRANSITIONS[issue.state] ?? [];

  return (
    <div className="space-y-6">
      <Link
        href={`${basePath}/issues`}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Issues
      </Link>

      <Card hover={false} padding="p-6 space-y-4">
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-bold text-white">{issue.title}</h2>
          <div className="flex gap-2">
            <StatusBadge status={issue.state} />
            <StatusBadge status={issue.priority ?? 'medium'} />
          </div>
        </div>

        {issue.description && (
          <p className="text-sm text-slate-400 whitespace-pre-wrap">
            {issue.description}
          </p>
        )}

        <div className="flex gap-2 text-xs text-slate-500">
          <span>Type: {issue.type ?? 'task'}</span>
          <span>&middot;</span>
          <span>Source: {issue.source ?? 'internal'}</span>
          <span>&middot;</span>
          <span>Created: {new Date(issue.createdAt).toLocaleString()}</span>
        </div>

        {transitions.length > 0 && (
          <div className="flex gap-2 pt-3 border-t border-slate-700/20">
            <span className="text-xs text-slate-500 py-1.5">Move to:</span>
            {transitions.map((state) => (
              <button
                key={state}
                type="button"
                onClick={() =>
                  transitionMutation.mutate({
                    id: issue.id,
                    state: state as 'open' | 'in_progress' | 'blocked' | 'closed',
                  })
                }
                disabled={transitionMutation.isPending}
                className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] text-sm text-slate-300 rounded-lg transition-colors capitalize disabled:opacity-50 border border-slate-700/20"
              >
                {state.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Activity Log */}
      <div>
        <h3 className="text-sm font-semibold text-slate-400 mb-4">Activity</h3>
        {events.length === 0 ? (
          <p className="text-sm text-slate-600">No activity yet.</p>
        ) : (
          <div className="relative pl-6">
            {/* Timeline line */}
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-700/30" />
            <div className="space-y-0">
              {events.map((event) => (
                <div
                  key={event.id}
                  className="relative flex items-start gap-3 py-2.5"
                >
                  {/* Timeline dot */}
                  <div className="absolute left-[-19px] top-3.5 w-2.5 h-2.5 rounded-full bg-slate-700 border-2 border-slate-800" />
                  <span className="text-[11px] text-slate-600 font-mono whitespace-nowrap mt-0.5">
                    {new Date(event.timestamp).toLocaleString()}
                  </span>
                  <span className="text-sm capitalize font-medium text-slate-300">
                    {event.type.replace(/_/g, ' ')}
                  </span>
                  {event.payload != null && (
                    <span className="text-sm text-slate-500 truncate">
                      {formatPayload(event.payload as Record<string, unknown>)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, unknown>;
  if (obj.from && obj.to) return `${obj.from} → ${obj.to}`;
  if (obj.title) return String(obj.title);
  return JSON.stringify(payload);
}
