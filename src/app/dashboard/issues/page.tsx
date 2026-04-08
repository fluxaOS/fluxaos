'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { trpc } from '@/lib/trpc/client';

const states = ['all', 'open', 'in_progress', 'blocked', 'closed'] as const;
const types = ['all', 'task', 'bug', 'feature', 'research'] as const;
const priorities = ['low', 'medium', 'high', 'critical'] as const;

export default function IssuesPage() {
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);

  // Get project context
  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const projectsQuery = trpc.project.list.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const projectId = projectsQuery.data?.[0]?.id;

  const issuesQuery = trpc.issue.list.useQuery(
    {
      projectId: projectId!,
      ...(stateFilter !== 'all' && {
        state: stateFilter as 'open' | 'in_progress' | 'blocked' | 'closed',
      }),
      ...(typeFilter !== 'all' && {
        type: typeFilter as 'task' | 'bug' | 'feature' | 'research',
      }),
    },
    { enabled: !!projectId }
  );

  const issues = issuesQuery.data ?? [];

  if (!projectId && !orgsQuery.isLoading && !projectsQuery.isLoading) {
    return <EmptyState title="No project found" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Issues</h2>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
        >
          {showCreate ? 'Cancel' : 'New Issue'}
        </button>
      </div>

      {showCreate && projectId && (
        <CreateIssueForm
          projectId={projectId}
          onCreated={() => {
            setShowCreate(false);
            issuesQuery.refetch();
          }}
        />
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="bg-sidebar border border-sidebar-border rounded-md px-3 py-1.5 text-sm text-foreground"
        >
          {states.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All States' : s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-sidebar border border-sidebar-border rounded-md px-3 py-1.5 text-sm text-foreground"
        >
          {types.map((t) => (
            <option key={t} value={t}>
              {t === 'all' ? 'All Types' : t}
            </option>
          ))}
        </select>
      </div>

      {/* Issue Table */}
      {issuesQuery.isLoading ? (
        <div className="text-muted text-sm py-8 text-center">Loading...</div>
      ) : issues.length === 0 ? (
        <EmptyState
          title="No issues found"
          description="Create your first issue to get started."
        />
      ) : (
        <div className="bg-sidebar border border-sidebar-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sidebar-border text-muted text-left">
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 font-medium">Priority</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr
                  key={issue.id}
                  className="border-b border-sidebar-border last:border-0 hover:bg-white/5"
                >
                  <td className="px-4 py-2">
                    <Link
                      href={`/dashboard/issues/${issue.id}`}
                      className="text-accent hover:text-accent-hover"
                    >
                      {issue.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={issue.state} />
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={issue.priority ?? 'medium'} />
                  </td>
                  <td className="px-4 py-2 text-muted capitalize">
                    {issue.type ?? 'task'}
                  </td>
                  <td className="px-4 py-2 text-muted">
                    {new Date(issue.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreateIssueForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<string>('medium');
  const [type, setType] = useState<string>('task');

  const createMutation = trpc.issue.create.useMutation({
    onSuccess: () => onCreated(),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        createMutation.mutate({
          projectId,
          title: title.trim(),
          description: description.trim() || undefined,
          priority: priority as 'low' | 'medium' | 'high' | 'critical',
          type: type as 'task' | 'bug' | 'feature' | 'research',
        });
      }}
      className="bg-sidebar border border-sidebar-border rounded-lg p-4 space-y-3"
    >
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Issue title"
        className="w-full bg-background border border-sidebar-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={3}
        className="w-full bg-background border border-sidebar-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent resize-none"
      />
      <div className="flex gap-3">
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="bg-background border border-sidebar-border rounded-md px-3 py-1.5 text-sm text-foreground"
        >
          {priorities.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="bg-background border border-sidebar-border rounded-md px-3 py-1.5 text-sm text-foreground"
        >
          {types
            .filter((t) => t !== 'all')
            .map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
        </select>
        <button
          type="submit"
          disabled={!title.trim() || createMutation.isPending}
          className="ml-auto px-4 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
        >
          {createMutation.isPending ? 'Creating...' : 'Create'}
        </button>
      </div>
      {createMutation.error && (
        <p className="text-sm text-red-400">{createMutation.error.message}</p>
      )}
    </form>
  );
}
