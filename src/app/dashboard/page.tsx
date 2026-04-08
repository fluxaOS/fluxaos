'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { trpc } from '@/lib/trpc/client';

export default function DashboardPage() {
  const [prompt, setPrompt] = useState('');

  // Load first org → first project (alpha: single-user, single-project)
  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;

  const projectsQuery = trpc.project.list.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const project = projectsQuery.data?.[0];
  const projectId = project?.id;

  // Load issues and pipeline runs for stats
  const issuesQuery = trpc.issue.list.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const runsQuery = trpc.pipeline.listRunsByProject.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const justDoIt = trpc.pipeline.justDoIt.useMutation({
    onSuccess: () => {
      setPrompt('');
      runsQuery.refetch();
    },
  });

  const issues = issuesQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const recentRuns = runs.slice(0, 5);

  const openIssues = issues.filter((i) => i.state === 'open').length;
  const inProgress = issues.filter((i) => i.state === 'in_progress').length;
  const totalRuns = runs.length;
  const runningRuns = runs.filter((r) => r.status === 'running').length;

  const isLoading = orgsQuery.isLoading || projectsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted">
        Loading...
      </div>
    );
  }

  if (!project) {
    return (
      <EmptyState
        title="No project found"
        description="Run the seed script to create the default project."
      />
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-1">{project.name}</h2>
        <p className="text-sm text-muted">Dashboard</p>
      </div>

      {/* Just Do It */}
      <div className="bg-sidebar border border-sidebar-border rounded-lg p-6">
        <h3 className="text-sm font-medium text-muted mb-3">Just Do It</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (prompt.trim() && projectId) {
              justDoIt.mutate({ projectId, prompt: prompt.trim() });
            }
          }}
          className="flex gap-3"
        >
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you want done..."
            className="flex-1 bg-background border border-sidebar-border rounded-md px-4 py-2 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={!prompt.trim() || justDoIt.isPending}
            className="px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
          >
            {justDoIt.isPending ? 'Starting...' : 'Go'}
          </button>
        </form>
        {justDoIt.error && (
          <p className="mt-2 text-sm text-red-400">{justDoIt.error.message}</p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Open Issues" value={openIssues} />
        <StatCard label="In Progress" value={inProgress} />
        <StatCard label="Total Runs" value={totalRuns} />
        <StatCard label="Running" value={runningRuns} />
      </div>

      {/* Recent Runs */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-muted">
            Recent Pipeline Runs
          </h3>
          <Link
            href="/dashboard/pipelines"
            className="text-xs text-accent hover:text-accent-hover"
          >
            View all
          </Link>
        </div>
        {recentRuns.length === 0 ? (
          <EmptyState
            title="No pipeline runs yet"
            description="Use 'Just Do It' above or start a run from the Pipelines page."
          />
        ) : (
          <div className="bg-sidebar border border-sidebar-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sidebar-border text-muted text-left">
                  <th className="px-4 py-2 font-medium">Pipeline</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Started</th>
                  <th className="px-4 py-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr
                    key={run.id}
                    className="border-b border-sidebar-border last:border-0 hover:bg-white/5"
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/dashboard/pipelines/${run.id}`}
                        className="text-accent hover:text-accent-hover"
                      >
                        {run.pipelineName}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="px-4 py-2 text-muted">
                      {run.startedAt
                        ? new Date(run.startedAt).toLocaleString()
                        : '-'}
                    </td>
                    <td className="px-4 py-2 text-muted">
                      ${run.totalCostUsd ?? '0.00'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-sidebar border border-sidebar-border rounded-lg p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
