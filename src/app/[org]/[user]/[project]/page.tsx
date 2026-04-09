'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { CircleDot, Loader, Play, Activity, Sparkles } from 'lucide-react';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SkeletonCard, SkeletonTable } from '@/components/skeleton';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { trpc } from '@/lib/trpc/client';

function useBasePath() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  return segments.length >= 3 ? `/${segments[0]}/${segments[1]}/${segments[2]}` : '/';
}

export default function DashboardPage() {
  const [prompt, setPrompt] = useState('');
  const basePath = useBasePath();

  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;

  const projectsQuery = trpc.project.list.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const project = projectsQuery.data?.[0];
  const projectId = project?.id;

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
      <div className="space-y-5">
        <PageHeader title="Dashboard" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
        <SkeletonTable />
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

  // Compute open issues by priority for sidebar
  const criticalIssues = issues.filter((i) => i.state === 'open' && i.priority === 'critical');
  const highIssues = issues.filter((i) => i.state === 'open' && i.priority === 'high');
  const mediumIssues = issues.filter((i) => i.state === 'open' && i.priority === 'medium');
  const topIssues = [...criticalIssues, ...highIssues, ...mediumIssues].slice(0, 3);

  // Pipeline health
  const completedRuns = runs.filter((r) => r.status === 'completed').length;
  const successRate = totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0;

  // Cost
  const totalCost = runs.reduce((sum, r) => sum + Number(r.totalCostUsd ?? 0), 0);

  return (
    <div className="space-y-5">
      {/* Breadcrumb + title */}
      <div>
        <p className="text-xs text-slate-500 mb-1">Pages / Dashboard</p>
        <h2 className="text-2xl font-bold text-white">{project.name}</h2>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Open issues" value={openIssues} icon={CircleDot} accent="violet" />
        <StatCard label="In progress" value={inProgress} icon={Loader} accent="blue" />
        <StatCard label="Total runs" value={totalRuns} icon={Play} accent="green" />
        <StatCard label="Running now" value={runningRuns} icon={Activity} accent="amber" />
      </div>

      {/* Bento row: Just Do It + Pipeline Health */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {/* Just Do It hero */}
        <Card hover={false} padding="p-7" className="bg-linear-to-br from-deep-violet/50 to-card relative overflow-hidden">
          {/* Decorative glow */}
          <div className="absolute -top-12 -right-12 w-48 h-48 bg-electric-violet/10 rounded-full blur-3xl pointer-events-none" />

          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={18} className="text-soft-violet opacity-60" />
            <h3 className="text-lg font-bold text-white">Just Do It</h3>
          </div>
          <p className="text-xs text-slate-400 mb-5">
            Describe what you want done — fluxaOS handles the rest.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (prompt.trim() && projectId) {
                justDoIt.mutate({ projectId, prompt: prompt.trim() });
              }
            }}
            className="flex gap-3 relative z-1"
          >
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe what you want done..."
              className="flex-1 bg-slate-900 border border-slate-700/60 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-violet/30 focus:border-electric-violet/50 transition-all"
            />
            <button
              type="submit"
              disabled={!prompt.trim() || justDoIt.isPending}
              className="px-5 py-3 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.4)] hover:shadow-[0_6px_24px_rgba(124,58,237,0.5)] hover:-translate-y-0.5 flex items-center gap-2"
            >
              <Sparkles size={14} />
              {justDoIt.isPending ? 'Starting...' : 'Go'}
            </button>
          </form>
          {justDoIt.error && (
            <p className="mt-2 text-sm text-red-400">{justDoIt.error.message}</p>
          )}
        </Card>

        {/* Pipeline Health */}
        <Card padding="p-6" className="relative">
          <h3 className="text-sm font-semibold text-white">Pipeline health</h3>
          <p className="text-xs text-slate-500 mb-5">Last 30 days</p>
          <p className={`text-[42px] font-extrabold leading-none ${
            successRate >= 80 ? 'text-emerald-400' : successRate >= 50 ? 'text-amber-400' : 'text-red-400'
          }`}>
            {successRate}%
          </p>
          <p className="text-xs text-slate-500 mt-1">success rate</p>

          {/* Mini bar chart */}
          <div className="absolute right-6 bottom-6 flex items-end gap-1.5 h-[60px]">
            {[52, 36, 48, 20, 42, 56, 30].map((h, i) => (
              <div
                key={i}
                className={`w-3.5 rounded-t ${h === 20 ? 'bg-red-400/60' : 'bg-emerald-400/60'}`}
                style={{ height: `${h}px` }}
              />
            ))}
          </div>
        </Card>
      </div>

      {/* Bento row: Recent Runs + Right column */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {/* Recent Pipeline Runs */}
        <Card hover={false} padding="p-0">
          <div className="flex items-center justify-between px-6 pt-5 pb-4">
            <h3 className="text-sm font-semibold text-white">
              Recent pipeline runs
            </h3>
            <Link
              href={`${basePath}/pipelines`}
              className="text-xs text-soft-violet hover:text-electric-violet font-medium transition-colors"
            >
              View all &rarr;
            </Link>
          </div>
          {recentRuns.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState
                title="No pipeline runs yet"
                description="Use 'Just Do It' above or start a run from the Pipelines page."
              />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Pipeline</th>
                  <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Status</th>
                  <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Started</th>
                  <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Cost</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr
                    key={run.id}
                    className="border-t border-slate-700/15 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-6 py-3.5">
                      <Link
                        href={`${basePath}/pipelines/${run.id}`}
                        className="text-slate-200 font-medium hover:text-white transition-colors"
                      >
                        {run.pipelineName}
                      </Link>
                    </td>
                    <td className="px-6 py-3.5">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="px-6 py-3.5 text-xs text-slate-500">
                      {run.startedAt
                        ? new Date(run.startedAt).toLocaleString()
                        : '-'}
                    </td>
                    <td className="px-6 py-3.5 text-xs font-mono text-slate-400">
                      ${run.totalCostUsd ?? '0.00'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Right column: Cost + Issues */}
        <div className="flex flex-col gap-5">
          {/* Cost Summary */}
          <Card padding="p-6">
            <h3 className="text-sm font-semibold text-white">Total spend</h3>
            <p className="text-xs text-slate-500 mt-0.5">All pipeline runs</p>
            <p className="text-4xl font-extrabold text-white mt-4 font-mono">
              ${totalCost.toFixed(2)}
            </p>
            <p className="text-xs text-slate-500 mt-1.5">
              Avg <span className="font-mono text-slate-400">${totalRuns > 0 ? (totalCost / totalRuns).toFixed(3) : '0.000'}</span> / run
            </p>
            {/* Sparkline */}
            <div className="flex items-end gap-[3px] h-6 mt-3">
              {[8, 12, 10, 16, 14, 20, 18, 22, 16, 24, 20, 14, 18, 22].map((h, i) => (
                <div
                  key={i}
                  className="w-1 rounded-sm bg-soft-violet/50"
                  style={{ height: `${h}px` }}
                />
              ))}
            </div>
          </Card>

          {/* Open Issues */}
          <Card padding="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Open issues</h3>
              <Link
                href={`${basePath}/issues`}
                className="text-xs text-soft-violet hover:text-electric-violet font-medium transition-colors"
              >
                View all &rarr;
              </Link>
            </div>
            {topIssues.length === 0 ? (
              <p className="text-xs text-slate-500">No open issues.</p>
            ) : (
              <div className="space-y-0">
                {topIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className="flex items-start gap-3 py-2.5 border-b border-slate-700/15 last:border-0"
                  >
                    <div
                      className={`w-1 h-8 rounded-full flex-shrink-0 mt-0.5 ${
                        issue.priority === 'critical'
                          ? 'bg-error shadow-[0_0_8px_rgba(206,18,18,0.3)]'
                          : issue.priority === 'high'
                            ? 'bg-warning shadow-[0_0_8px_rgba(245,163,20,0.3)]'
                            : 'bg-info shadow-[0_0_8px_rgba(9,127,195,0.3)]'
                      }`}
                    />
                    <div>
                      <Link
                        href={`${basePath}/issues/${issue.id}`}
                        className="text-xs font-medium text-slate-300 hover:text-white transition-colors"
                      >
                        {issue.title}
                      </Link>
                      <p className="text-[10px] text-slate-600 mt-0.5">
                        {issue.priority} &middot;{' '}
                        {new Date(issue.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Providers bar */}
      <ProvidersBar orgId={orgId} />
    </div>
  );
}

function ProvidersBar({ orgId }: { orgId: string | undefined }) {
  const providersQuery = trpc.provider.list.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const providers = providersQuery.data ?? [];

  if (providers.length === 0) return null;

  return (
    <Card hover={false} padding="px-6 py-4">
      <div className="flex items-center gap-9">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">
          Providers
        </span>
        {providers.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-sm">
            <span
              className={`w-2 h-2 rounded-full ${
                p.isHealthy
                  ? 'bg-emerald-400 dot-glow-green'
                  : 'bg-red-400 dot-glow-red'
              }`}
            />
            <span className="text-slate-300">{p.name}</span>
            {p.isHealthy ? (
              <span className="text-[11px] text-slate-500">
                {/* model count not available in list, show type */}
                {p.type}
              </span>
            ) : (
              <span className="text-[11px] text-red-400">offline</span>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
