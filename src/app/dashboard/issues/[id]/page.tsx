'use client';

import Link from 'next/link';
import { use } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { trpc } from '@/lib/trpc/client';

const VALID_TRANSITIONS: Record<string, string[]> = {
  open: ['in_progress', 'blocked', 'closed'],
  in_progress: ['open', 'blocked', 'closed'],
  blocked: ['open', 'in_progress'],
  closed: ['open'],
};

export default function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
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
    return <div className="text-muted py-8 text-center">Loading...</div>;
  }

  if (!issue) {
    return <div className="text-muted py-8 text-center">Issue not found</div>;
  }

  const transitions = VALID_TRANSITIONS[issue.state] ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/issues"
          className="text-xs text-muted hover:text-foreground"
        >
          &larr; Back to Issues
        </Link>
      </div>

      <div className="bg-sidebar border border-sidebar-border rounded-lg p-6 space-y-4">
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-bold">{issue.title}</h2>
          <div className="flex gap-2">
            <StatusBadge status={issue.state} />
            <StatusBadge status={issue.priority ?? 'medium'} />
          </div>
        </div>

        {issue.description && (
          <p className="text-sm text-muted whitespace-pre-wrap">
            {issue.description}
          </p>
        )}

        <div className="flex gap-2 text-xs text-muted">
          <span>Type: {issue.type ?? 'task'}</span>
          <span>&middot;</span>
          <span>Source: {issue.source ?? 'internal'}</span>
          <span>&middot;</span>
          <span>Created: {new Date(issue.createdAt).toLocaleString()}</span>
        </div>

        {/* State Transitions */}
        {transitions.length > 0 && (
          <div className="flex gap-2 pt-2 border-t border-sidebar-border">
            <span className="text-xs text-muted py-1">Move to:</span>
            {transitions.map((state) => (
              <button
                key={state}
                type="button"
                onClick={() =>
                  transitionMutation.mutate({
                    id: issue.id,
                    state: state as
                      | 'open'
                      | 'in_progress'
                      | 'blocked'
                      | 'closed',
                  })
                }
                disabled={transitionMutation.isPending}
                className="px-3 py-1 bg-white/5 hover:bg-white/10 text-sm rounded-md transition-colors capitalize disabled:opacity-50"
              >
                {state.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Activity Log */}
      <div>
        <h3 className="text-sm font-medium text-muted mb-3">Activity</h3>
        {events.length === 0 ? (
          <p className="text-sm text-muted/70">No activity yet.</p>
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-3 text-sm py-2 border-b border-sidebar-border last:border-0"
              >
                <span className="text-muted text-xs whitespace-nowrap mt-0.5">
                  {new Date(event.timestamp).toLocaleString()}
                </span>
                <span className="capitalize font-medium">
                  {event.type.replace(/_/g, ' ')}
                </span>
                {event.payload != null && (
                  <span className="text-muted truncate">
                    {formatPayload(event.payload as Record<string, unknown>)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, unknown>;
  if (obj.from && obj.to) return `${obj.from} \u2192 ${obj.to}`;
  if (obj.title) return String(obj.title);
  return JSON.stringify(payload);
}
