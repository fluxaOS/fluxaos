'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SkeletonTable } from '@/components/skeleton';
import { StatusBadge } from '@/components/status-badge';
import { trpc } from '@/lib/trpc/client';

function useProjectId() {
  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const projectsQuery = trpc.project.listByOrg.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId },
  );
  return {
    projectId: projectsQuery.data?.[0]?.id ?? null,
    isLoading: orgsQuery.isLoading || projectsQuery.isLoading,
  };
}

function useBasePath() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  return segments.length >= 3 ? `/${segments[0]}/${segments[1]}/${segments[2]}` : '/';
}

export default function PipelinesPage() {
  const basePath = useBasePath();
  const { projectId, isLoading: projectLoading } = useProjectId();

  const pipelinesQuery = trpc.pipeline.listByProject.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId },
  );

  const runsQuery = trpc.pipeline.runs.listByProject.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId },
  );

  const defaultPipeline = pipelinesQuery.data?.find((p) => p.isDefault) ?? pipelinesQuery.data?.[0];

  const triggerRun = trpc.pipeline.runs.trigger.useMutation({
    onSuccess: () => runsQuery.refetch(),
  });

  const runs = runsQuery.data ?? [];

  if (projectLoading) {
    return (
      <div className="space-y-5">
        <PageHeader title="Pipeline runs" />
        <SkeletonTable />
      </div>
    );
  }

  if (!projectId) {
    return <EmptyState title="No project found" />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pipeline runs"
        action={
          defaultPipeline ? (
            <button
              type="button"
              onClick={() => triggerRun.mutate({ pipelineId: defaultPipeline.id, issueId: '' })}
              disabled={triggerRun.isPending}
              className="px-4 py-2 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.3)]"
            >
              {triggerRun.isPending ? 'Starting...' : 'Start Run'}
            </button>
          ) : undefined
        }
      />

      {triggerRun.error && (
        <p className="text-sm text-red-400">{triggerRun.error.message}</p>
      )}

      {runsQuery.isLoading ? (
        <SkeletonTable />
      ) : runs.length === 0 ? (
        <EmptyState
          title="No pipeline runs yet"
          description="Start a run using the button above or trigger from an issue."
        />
      ) : (
        <Card hover={false} padding="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Run</th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Pipeline</th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Status</th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Started</th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Completed</th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run: typeof runs[number]) => (
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
                    {(run as any).pipelineName || run.pipelineId.slice(0, 8)}
                  </td>
                  <td className="px-6 py-3.5">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-6 py-3.5 text-xs text-slate-500">
                    {run.startedAt ? new Date(run.startedAt).toLocaleString() : '-'}
                  </td>
                  <td className="px-6 py-3.5 text-xs text-slate-500">
                    {run.completedAt ? new Date(run.completedAt).toLocaleString() : '-'}
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
