'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SkeletonTable } from '@/components/skeleton';
import { StatusBadge } from '@/components/status-badge';
import { projectBaseFromPathname } from '@/lib/project-url';
import { trpc } from '@/lib/trpc/client';

function useProjectId() {
  const params = useParams<{ projectUuid: string }>();
  const projectQuery = trpc.project.getById.useQuery(
    { id: params.projectUuid },
    { enabled: !!params.projectUuid }
  );
  return {
    projectId: projectQuery.data?.id ?? null,
    isLoading: projectQuery.isLoading,
  };
}

function useBasePath() {
  return projectBaseFromPathname(usePathname());
}

export default function PipelinesPage() {
  const basePath = useBasePath();
  const { projectId, isLoading: projectLoading } = useProjectId();

  const runsQuery = trpc.pipeline.runs.listByProject.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const runs = runsQuery.data ?? [];

  if (projectLoading) {
    return (
      <div className="space-y-5">
        <PageHeader title="Pipeline Runs" />
        <SkeletonTable />
      </div>
    );
  }

  if (!projectId) {
    return <EmptyState title="No Project Found" />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pipeline Runs"
        action={
          undefined /* Runs are triggered from issue detail with a specific stage */
        }
      />

      {runsQuery.isLoading ? (
        <SkeletonTable />
      ) : runs.length === 0 ? (
        <EmptyState
          title="No Pipeline Runs Yet"
          description="Start a run using the button above or trigger from an issue."
        />
      ) : (
        <Card hover={false} padding="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Run
                </th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Pipeline
                </th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Status
                </th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Started
                </th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Completed
                </th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run: (typeof runs)[number]) => (
                <tr
                  key={run.id}
                  className="border-t border-slate-700/15 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-6 py-3.5">
                    <Link
                      href={`${basePath}/pipelines/${run.id}`}
                      className="text-soft-violet hover:text-electric-violet font-mono text-xs transition-colors"
                    >
                      {run.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-6 py-3.5 text-slate-300 font-medium">
                    {run.pipelineName || run.pipelineId.slice(0, 8)}
                  </td>
                  <td className="px-6 py-3.5">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-6 py-3.5 text-xs text-slate-500">
                    {run.startedAt
                      ? new Date(run.startedAt).toLocaleString()
                      : '-'}
                  </td>
                  <td className="px-6 py-3.5 text-xs text-slate-500">
                    {run.completedAt
                      ? new Date(run.completedAt).toLocaleString()
                      : '-'}
                  </td>
                  <td className="px-6 py-3.5 text-xs font-mono text-slate-400">
                    ${run.totalCostUsd ?? '0.00'}
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
