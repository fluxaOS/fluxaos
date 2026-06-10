'use client';

import { Activity, CircleDot, Loader, Play, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card } from '@/components/card';
import { CatalogBadge } from '@/components/catalog-badge';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SkeletonCard, SkeletonTable } from '@/components/skeleton';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { trpc } from '@/lib/trpc/client';

export function DashboardClient({
  projectId,
  projectName,
  basePath,
}: {
  projectId: string;
  projectName: string;
  basePath: string;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');

  // ── Catalog queries ──────────────────────────────────────────────────────
  const statesQuery = trpc.issueCatalog.states.list.useQuery({ projectId });
  const typesQuery = trpc.issueCatalog.types.list.useQuery({ projectId });
  const prioritiesQuery = trpc.issueCatalog.priorities.list.useQuery({
    projectId,
  });

  const states = statesQuery.data ?? [];
  const types = typesQuery.data ?? [];
  const priorities = prioritiesQuery.data ?? [];

  const priorityMap = new Map(priorities.map((p) => [p.id, p]));

  // ── Just Do It — create an issue and let the pipeline take over ─────────
  // Same mutation + catalog derivation as the New Issue form: default to the
  // first active type/priority from the project's catalogs.
  const createIssueMutation = trpc.issue.create.useMutation({
    onSuccess: (data) => {
      router.push(`${basePath}/issues/${data.number}`);
    },
  });

  // ── Issue queries ────────────────────────────────────────────────────────
  const issuesQuery = trpc.issue.list.useQuery({ projectId });
  const issues = issuesQuery.data ?? [];

  const openIssues = issues.filter((i) => !i.isClosed);
  const _closedIssues = issues.filter((i) => i.isClosed);

  // Count issues per state
  const stateCounts = new Map<string, number>();
  for (const iss of issues) {
    stateCounts.set(iss.stateId, (stateCounts.get(iss.stateId) || 0) + 1);
  }

  // Find "in progress" count — non-terminal, non-initial states
  const nonTerminalStates = states.filter((s) => !s.isTerminal);
  const inProgressCount =
    nonTerminalStates.reduce(
      (sum, s) => sum + (stateCounts.get(s.id) ?? 0),
      0
    ) -
    (stateCounts.get(
      states.find(
        (s) => s.sortOrder === Math.min(...states.map((x) => x.sortOrder))
      )?.id ?? ''
    ) ?? 0);

  // ── Pipeline queries ─────────────────────────────────────────────────────
  const kpisQuery = trpc.pipeline.runs.kpis.useQuery({ projectId });
  const runsQuery = trpc.pipeline.runs.listByProject.useQuery({ projectId });

  const kpis = kpisQuery.data;
  const runs = runsQuery.data ?? [];
  const recentRuns = runs.slice(0, 5);

  // ── Provider queries ─────────────────────────────────────────────────────
  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const providersQuery = trpc.provider.list.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const providers = providersQuery.data ?? [];

  // Sort open issues by priority weight (highest weight first)
  const priorityWeight = new Map(priorities.map((p) => [p.id, p.weight]));
  const topOpenIssues = [...openIssues]
    .sort(
      (a, b) =>
        (priorityWeight.get(b.priorityId) ?? 0) -
        (priorityWeight.get(a.priorityId) ?? 0)
    )
    .slice(0, 5);

  const isLoading =
    statesQuery.isLoading || prioritiesQuery.isLoading || issuesQuery.isLoading;

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

  const successRate = kpis?.successRate ?? 0;
  const totalCost = Number(kpis?.totalCostUsd ?? 0);
  const totalRuns = kpis?.totalRuns ?? 0;

  return (
    <div className="space-y-5">
      {/* Breadcrumb + title */}
      <div>
        <p className="text-xs text-slate-500 mb-1">Pages / Dashboard</p>
        <h2 className="text-2xl font-bold text-white">{projectName}</h2>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Open issues"
          value={openIssues.length}
          icon={CircleDot}
          accent="violet"
        />
        <StatCard
          label="In progress"
          value={Math.max(0, inProgressCount)}
          icon={Loader}
          accent="blue"
        />
        <StatCard
          label="Total runs"
          value={totalRuns}
          icon={Play}
          accent="green"
        />
        <StatCard
          label="Running now"
          value={kpis?.runningRuns ?? 0}
          icon={Activity}
          accent="amber"
        />
      </div>

      {/* Bento row: Just Do It + Pipeline Health */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {/* Just Do It hero */}
        <Card
          hover={false}
          padding="p-7"
          className="bg-linear-to-br from-deep-violet/50 to-card relative overflow-hidden"
        >
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
              if (
                !prompt.trim() ||
                types.length === 0 ||
                priorities.length === 0
              )
                return;
              createIssueMutation.mutate({
                projectId,
                title: prompt.trim(),
                typeId: types[0].id,
                priorityId: priorities[0].id,
              });
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
              disabled={
                !prompt.trim() ||
                types.length === 0 ||
                priorities.length === 0 ||
                createIssueMutation.isPending
              }
              className="px-5 py-3 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.4)] hover:shadow-[0_6px_24px_rgba(124,58,237,0.5)] hover:-translate-y-0.5 flex items-center gap-2"
            >
              <Sparkles size={14} />
              {createIssueMutation.isPending ? 'Creating…' : 'Go'}
            </button>
          </form>
          {createIssueMutation.error && (
            <p className="text-sm text-red-400 mt-3 relative z-1">
              {createIssueMutation.error.message}
            </p>
          )}
        </Card>

        {/* Pipeline Health */}
        <Card padding="p-6" className="relative">
          <h3 className="text-sm font-semibold text-white">Pipeline Health</h3>
          <p className="text-xs text-slate-500 mb-5">Last 30 days</p>
          <p
            className={`text-[42px] font-extrabold leading-none ${
              successRate >= 80
                ? 'text-emerald-400'
                : successRate >= 50
                  ? 'text-amber-400'
                  : 'text-red-400'
            }`}
          >
            {successRate}%
          </p>
          <p className="text-xs text-slate-500 mt-1">success rate</p>

          {/* Mini bar chart — based on recent runs */}
          <div className="absolute right-6 bottom-6 flex items-end gap-1.5 h-[60px]">
            {recentRuns.slice(0, 7).map((run) => {
              const isSuccess = run.status === 'completed';
              // Deterministic per-run pseudo-height: hash run.id into [20, 56] px
              // so the bar chart stays stable across re-renders.
              let hash = 0;
              for (let i = 0; i < run.id.length; i++) {
                hash = (hash * 31 + run.id.charCodeAt(i)) | 0;
              }
              const h = 20 + (Math.abs(hash) % 37);
              return (
                <div
                  key={run.id}
                  className={`w-3.5 rounded-t ${isSuccess ? 'bg-emerald-400/60' : 'bg-red-400/60'}`}
                  style={{ height: `${h}px` }}
                />
              );
            })}
            {recentRuns.length === 0 && (
              <p className="text-xs text-slate-600">No data</p>
            )}
          </div>
        </Card>
      </div>

      {/* Bento row: Recent Runs + Right column */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {/* Recent Pipeline Runs */}
        <Card hover={false} padding="p-0">
          <div className="flex items-center justify-between px-6 pt-5 pb-4">
            <h3 className="text-sm font-semibold text-white">
              Recent Pipeline Runs
            </h3>
            <Link
              href={`${basePath}/pipelines`}
              className="text-xs text-soft-violet hover:text-electric-violet font-medium transition-colors"
            >
              View All &rarr;
            </Link>
          </div>
          {recentRuns.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState
                title="No Pipeline Runs Yet"
                description="Use 'Just Do It' above or start a run from the Pipelines page."
              />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                    Pipeline
                  </th>
                  <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                    Status
                  </th>
                  <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                    Started
                  </th>
                  <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run: (typeof recentRuns)[number]) => (
                  <tr
                    key={run.id}
                    className="border-t border-slate-700/15 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-6 py-3.5">
                      <Link
                        href={`${basePath}/pipelines/${run.id}`}
                        className="text-slate-200 font-medium hover:text-white transition-colors"
                      >
                        {run.pipelineId.slice(0, 8)}
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
            <h3 className="text-sm font-semibold text-white">Total Spend</h3>
            <p className="text-xs text-slate-500 mt-0.5">All pipeline runs</p>
            <p className="text-4xl font-extrabold text-white mt-4 font-mono">
              ${totalCost.toFixed(2)}
            </p>
            <p className="text-xs text-slate-500 mt-1.5">
              Avg{' '}
              <span className="font-mono text-slate-400">
                ${totalRuns > 0 ? (totalCost / totalRuns).toFixed(3) : '0.000'}
              </span>{' '}
              / run
            </p>
            {/* Sparkline */}
            <div className="flex items-end gap-[3px] h-6 mt-3">
              {runs.slice(0, 14).map((run, _i) => (
                <div
                  key={run.id}
                  className="w-1 rounded-sm bg-soft-violet/50"
                  style={{
                    height: `${8 + Number(run.totalCostUsd ?? 0) * 10}px`,
                  }}
                />
              ))}
            </div>
          </Card>

          {/* Open Issues */}
          <Card padding="p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Open Issues</h3>
              <Link
                href={`${basePath}/issues`}
                className="text-xs text-soft-violet hover:text-electric-violet font-medium transition-colors"
              >
                View All &rarr;
              </Link>
            </div>
            {topOpenIssues.length === 0 ? (
              <p className="text-xs text-slate-500">No open issues.</p>
            ) : (
              <div className="space-y-0">
                {topOpenIssues.map((iss) => {
                  const pri = priorityMap.get(iss.priorityId);
                  return (
                    <div
                      key={iss.id}
                      className="flex items-start gap-3 py-2.5 border-b border-slate-700/15 last:border-0"
                    >
                      <div
                        className="w-1 h-8 rounded-full flex-shrink-0 mt-0.5"
                        style={{
                          backgroundColor: pri?.color ?? '#64748b',
                          boxShadow: pri ? `0 0 8px ${pri.color}50` : undefined,
                        }}
                      />
                      <div>
                        <Link
                          href={`${basePath}/issues/${iss.number}`}
                          className="text-xs font-medium text-slate-300 hover:text-white transition-colors"
                        >
                          {iss.title}
                        </Link>
                        <p className="text-[10px] text-slate-600 mt-0.5">
                          {pri?.displayName ?? 'Unknown'} &middot;{' '}
                          {new Date(iss.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Issue State Breakdown */}
      <Card padding="p-6">
        <h3 className="text-sm font-semibold text-white">Issues by State</h3>
        <p className="text-xs text-slate-500 mb-5">Current distribution</p>
        <div className="space-y-3">
          {states.map((s) => {
            const count = stateCounts.get(s.id) ?? 0;
            const pct =
              issues.length > 0 ? Math.round((count / issues.length) * 100) : 0;
            return (
              <div key={s.id} className="flex items-center gap-3">
                <CatalogBadge displayName={s.displayName} color={s.color} />
                <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: s.color }}
                  />
                </div>
                <span className="text-xs font-mono text-slate-400 w-8 text-right">
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Providers bar */}
      {providers.length > 0 && (
        <Card hover={false} padding="px-6 py-3">
          <div className="flex items-center gap-6 text-xs">
            <span className="text-slate-500 font-medium uppercase tracking-wider text-[10px]">
              Providers
            </span>
            {providers.map((p) => (
              <span key={p.id} className="flex items-center gap-1.5">
                <span
                  className={`w-2 h-2 rounded-full ${p.isHealthy ? 'bg-emerald-400' : 'bg-red-400'}`}
                  style={{
                    boxShadow: p.isHealthy
                      ? '0 0 6px rgba(52,211,153,0.5)'
                      : '0 0 6px rgba(248,113,113,0.5)',
                  }}
                />
                <span className="text-slate-300 font-medium">{p.name}</span>
                <span className="text-slate-500">
                  {p.isHealthy ? 'Online' : 'Offline'}
                </span>
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
