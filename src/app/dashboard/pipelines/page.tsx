'use client';

import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { trpc } from '@/lib/trpc/client';

export default function PipelinesPage() {
  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const projectsQuery = trpc.project.list.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const project = projectsQuery.data?.[0];
  const projectId = project?.id;

  const runsQuery = trpc.pipeline.listRunsByProject.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const pipelinesQuery = trpc.pipeline.list.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const startRun = trpc.pipeline.startRun.useMutation({
    onSuccess: () => runsQuery.refetch(),
  });

  const runs = runsQuery.data ?? [];
  const pipelines = pipelinesQuery.data ?? [];
  const defaultPipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];

  const isLoading = orgsQuery.isLoading || projectsQuery.isLoading;

  if (isLoading) {
    return <div className="text-muted py-8 text-center">Loading...</div>;
  }

  if (!projectId) {
    return <EmptyState title="No project found" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Pipeline Runs</h2>
        {defaultPipeline && (
          <button
            type="button"
            onClick={() => startRun.mutate({ pipelineId: defaultPipeline.id })}
            disabled={startRun.isPending}
            className="px-3 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
          >
            {startRun.isPending ? 'Starting...' : 'Start Run'}
          </button>
        )}
      </div>

      {startRun.error && (
        <p className="text-sm text-red-400">{startRun.error.message}</p>
      )}

      {runsQuery.isLoading ? (
        <div className="text-muted text-sm py-8 text-center">Loading...</div>
      ) : runs.length === 0 ? (
        <EmptyState
          title="No pipeline runs yet"
          description="Start a run using the button above or the dashboard's Just Do It."
        />
      ) : (
        <div className="bg-sidebar border border-sidebar-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sidebar-border text-muted text-left">
                <th className="px-4 py-2 font-medium">Run</th>
                <th className="px-4 py-2 font-medium">Pipeline</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Completed</th>
                <th className="px-4 py-2 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-b border-sidebar-border last:border-0 hover:bg-white/5"
                >
                  <td className="px-4 py-2">
                    <Link
                      href={`/dashboard/pipelines/${run.id}`}
                      className="text-accent hover:text-accent-hover font-mono text-xs"
                    >
                      {run.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{run.pipelineName}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-2 text-muted">
                    {run.startedAt
                      ? new Date(run.startedAt).toLocaleString()
                      : '-'}
                  </td>
                  <td className="px-4 py-2 text-muted">
                    {run.completedAt
                      ? new Date(run.completedAt).toLocaleString()
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
  );
}
