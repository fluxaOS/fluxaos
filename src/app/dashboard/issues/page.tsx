'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Filter } from 'lucide-react';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SkeletonTable } from '@/components/skeleton';
import { StatusBadge } from '@/components/status-badge';
import { trpc } from '@/lib/trpc/client';

const states = ['all', 'open', 'in_progress', 'blocked', 'closed'] as const;
const types = ['all', 'task', 'bug', 'feature', 'research'] as const;
const priorities = ['low', 'medium', 'high', 'critical'] as const;

export default function IssuesPage() {
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);

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
    <div className="space-y-5">
      <PageHeader
        title="Issues"
        action={
          <button
            type="button"
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 bg-electric-violet hover:bg-accent-hover text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.3)] hover:shadow-[0_6px_24px_rgba(124,58,237,0.4)]"
          >
            {showCreate ? 'Cancel' : 'New Issue'}
          </button>
        }
      />

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
      <div className="flex items-center gap-3">
        <Filter size={14} className="text-slate-500" />
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="bg-card border border-card-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-electric-violet/30"
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
          className="bg-card border border-card-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-electric-violet/30"
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
        <SkeletonTable />
      ) : issues.length === 0 ? (
        <EmptyState
          title="No issues found"
          description="Create your first issue to get started."
        />
      ) : (
        <Card hover={false} padding="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Title</th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">State</th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Priority</th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Type</th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Created</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((issue) => (
                <tr
                  key={issue.id}
                  className="border-t border-slate-700/15 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-6 py-3.5">
                    <Link
                      href={`/dashboard/issues/${issue.id}`}
                      className="text-slate-200 font-medium hover:text-white transition-colors"
                    >
                      {issue.title}
                    </Link>
                  </td>
                  <td className="px-6 py-3.5">
                    <StatusBadge status={issue.state} />
                  </td>
                  <td className="px-6 py-3.5">
                    <StatusBadge status={issue.priority ?? 'medium'} />
                  </td>
                  <td className="px-6 py-3.5 text-xs text-slate-500 capitalize">
                    {issue.type ?? 'task'}
                  </td>
                  <td className="px-6 py-3.5 text-xs text-slate-500">
                    {new Date(issue.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
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
    <Card hover={false} padding="p-5">
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
        className="space-y-3"
      >
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Issue title"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-violet/30"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          rows={3}
          className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-violet/30 resize-none"
        />
        <div className="flex gap-3">
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-electric-violet/30"
          >
            {priorities.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-electric-violet/30"
          >
            {types.filter((t) => t !== 'all').map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!title.trim() || createMutation.isPending}
            className="ml-auto px-4 py-1.5 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.3)]"
          >
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
        {createMutation.error && (
          <p className="text-sm text-red-400">{createMutation.error.message}</p>
        )}
      </form>
    </Card>
  );
}
