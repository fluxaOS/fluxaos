'use client';

import {
  Activity,
  Ban,
  CheckCircle,
  DollarSign,
  Play,
  XCircle,
} from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SkeletonCard } from '@/components/skeleton';
import { StatCard } from '@/components/stat-card';
import { trpc } from '@/lib/trpc/client';

export default function KpisPage() {
  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const projectsQuery = trpc.project.listByOrg.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const projectId = projectsQuery.data?.[0]?.id;

  const kpisQuery = trpc.pipeline.runs.kpis.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const kpis = kpisQuery.data;
  const isLoading = orgsQuery.isLoading || projectsQuery.isLoading;

  if (isLoading) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="KPIs"
          description="Pipeline run metrics, success rates, and cost summaries"
        />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!projectId) {
    return <EmptyState title="No Project Found" />;
  }

  if (!kpis) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="KPIs"
          description="Pipeline run metrics, success rates, and cost summaries"
        />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader title="KPIs" />

      <div>
        <h3 className="text-sm font-semibold text-slate-400 mb-3">
          Pipeline Runs
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <StatCard
            label="Total Runs"
            value={kpis.totalRuns}
            icon={Play}
            accent="violet"
          />
          <StatCard
            label="Success Rate"
            value={`${kpis.successRate}%`}
            icon={CheckCircle}
            accent={
              kpis.successRate >= 80
                ? 'green'
                : kpis.successRate >= 50
                  ? 'amber'
                  : 'violet'
            }
          />
          <StatCard
            label="Running"
            value={kpis.runningRuns}
            icon={Activity}
            accent="blue"
          />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-400 mb-3">
          Status Breakdown
        </h3>
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            label="Completed"
            value={kpis.completedRuns}
            icon={CheckCircle}
            accent="green"
          />
          <StatCard
            label="Failed"
            value={kpis.failedRuns}
            icon={XCircle}
            accent="amber"
          />
          <StatCard
            label="Cancelled"
            value={kpis.cancelledRuns}
            icon={Ban}
            accent="violet"
          />
          <StatCard
            label="Running"
            value={kpis.runningRuns}
            icon={Activity}
            accent="blue"
          />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-slate-400 mb-3">Cost</h3>
        <div className="grid grid-cols-2 gap-4">
          <StatCard
            label="Total Cost"
            value={`$${Number.parseFloat(kpis.totalCostUsd).toFixed(4)}`}
            icon={DollarSign}
            accent="green"
          />
          <StatCard
            label="Avg Cost / Run"
            value={`$${Number.parseFloat(kpis.avgCostUsd).toFixed(4)}`}
            icon={DollarSign}
            accent="blue"
          />
        </div>
      </div>
    </div>
  );
}
