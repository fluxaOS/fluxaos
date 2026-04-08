'use client';

import { EmptyState } from '@/components/empty-state';
import { trpc } from '@/lib/trpc/client';

export default function KpisPage() {
  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const projectsQuery = trpc.project.list.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const projectId = projectsQuery.data?.[0]?.id;

  const kpisQuery = trpc.pipeline.kpis.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const kpis = kpisQuery.data;
  const isLoading = orgsQuery.isLoading || projectsQuery.isLoading;

  if (isLoading) {
    return <div className="text-muted py-8 text-center">Loading...</div>;
  }

  if (!projectId) {
    return <EmptyState title="No project found" />;
  }

  if (!kpis) {
    return <div className="text-muted py-8 text-center">Loading KPIs...</div>;
  }

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">KPIs</h2>

      {/* Pipeline Run Stats */}
      <div>
        <h3 className="text-sm font-medium text-muted mb-3">Pipeline Runs</h3>
        <div className="grid grid-cols-3 gap-4">
          <KpiCard label="Total Runs" value={kpis.totalRuns} />
          <KpiCard
            label="Success Rate"
            value={`${kpis.successRate}%`}
            color={
              kpis.successRate >= 80
                ? 'text-green-400'
                : kpis.successRate >= 50
                  ? 'text-yellow-400'
                  : 'text-red-400'
            }
          />
          <KpiCard label="Running" value={kpis.runningRuns} />
        </div>
      </div>

      {/* Status Breakdown */}
      <div>
        <h3 className="text-sm font-medium text-muted mb-3">
          Status Breakdown
        </h3>
        <div className="grid grid-cols-4 gap-4">
          <KpiCard
            label="Completed"
            value={kpis.completedRuns}
            color="text-green-400"
          />
          <KpiCard
            label="Failed"
            value={kpis.failedRuns}
            color="text-red-400"
          />
          <KpiCard
            label="Cancelled"
            value={kpis.cancelledRuns}
            color="text-gray-400"
          />
          <KpiCard
            label="Running"
            value={kpis.runningRuns}
            color="text-blue-400"
          />
        </div>
      </div>

      {/* Cost */}
      <div>
        <h3 className="text-sm font-medium text-muted mb-3">Cost</h3>
        <div className="grid grid-cols-2 gap-4">
          <KpiCard
            label="Total Cost"
            value={`$${Number.parseFloat(kpis.totalCostUsd).toFixed(4)}`}
          />
          <KpiCard
            label="Avg Cost / Run"
            value={`$${Number.parseFloat(kpis.avgCostUsd).toFixed(4)}`}
          />
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color?: string;
}) {
  return (
    <div className="bg-sidebar border border-sidebar-border rounded-lg p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ?? ''}`}>{value}</p>
    </div>
  );
}
