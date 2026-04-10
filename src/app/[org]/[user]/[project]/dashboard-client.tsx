'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CircleDot, CheckCircle, List, Sparkles } from 'lucide-react';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SkeletonCard, SkeletonTable } from '@/components/skeleton';
import { StatCard } from '@/components/stat-card';
import { CatalogBadge } from '@/components/catalog-badge';
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
  const [prompt, setPrompt] = useState('');

  // ── Catalog queries ──────────────────────────────────────────────────────
  const statesQuery = trpc.issueCatalog.states.list.useQuery({ projectId });
  const prioritiesQuery = trpc.issueCatalog.priorities.list.useQuery({ projectId });

  const states = statesQuery.data ?? [];
  const priorities = prioritiesQuery.data ?? [];

  const stateMap = new Map(states.map((s) => [s.id, s]));
  const priorityMap = new Map(priorities.map((p) => [p.id, p]));

  // ── Issue queries ────────────────────────────────────────────────────────
  const issuesQuery = trpc.issue.list.useQuery({ projectId });
  const issues = issuesQuery.data ?? [];

  // Count open vs closed using isClosed boolean (no hardcoded state names)
  const openIssues = issues.filter((i) => !i.isClosed);
  const closedIssues = issues.filter((i) => i.isClosed);

  // Count issues per state
  const stateCounts = new Map<string, number>();
  for (const iss of issues) {
    stateCounts.set(iss.stateId, (stateCounts.get(iss.stateId) || 0) + 1);
  }

  // Sort open issues by priority weight (highest weight first)
  const priorityWeight = new Map(priorities.map((p) => [p.id, p.weight]));
  const topOpenIssues = [...openIssues]
    .sort((a, b) => (priorityWeight.get(b.priorityId) ?? 0) - (priorityWeight.get(a.priorityId) ?? 0))
    .slice(0, 5);

  const isLoading = statesQuery.isLoading || prioritiesQuery.isLoading || issuesQuery.isLoading;

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

  return (
    <div className="space-y-5">
      {/* Breadcrumb + title */}
      <div>
        <p className="text-xs text-slate-500 mb-1">Pages / Dashboard</p>
        <h2 className="text-2xl font-bold text-white">{projectName}</h2>
      </div>

      {/* Stat Cards — DB-driven, no hardcoded state/priority names */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total issues" value={issues.length} icon={List} accent="violet" />
        <StatCard label="Open" value={openIssues.length} icon={CircleDot} accent="blue" />
        <StatCard label="Closed" value={closedIssues.length} icon={CheckCircle} accent="green" />
        {/* Per-state breakdown: show the non-terminal state with the most issues */}
        {states.filter((s) => !s.isTerminal).length > 0 ? (
          <StatCard
            label={
              states
                .filter((s) => !s.isTerminal)
                .sort((a, b) => (stateCounts.get(b.id) ?? 0) - (stateCounts.get(a.id) ?? 0))[0]
                ?.displayName ?? 'Active'
            }
            value={
              stateCounts.get(
                states
                  .filter((s) => !s.isTerminal)
                  .sort((a, b) => (stateCounts.get(b.id) ?? 0) - (stateCounts.get(a.id) ?? 0))[0]?.id ?? '',
              ) ?? 0
            }
            accent="amber"
          />
        ) : (
          <StatCard label="States" value={0} accent="amber" />
        )}
      </div>

      {/* Bento row: Just Do It + Issue State Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {/* Just Do It hero — placeholder, pipeline not yet wired */}
        <Card hover={false} padding="p-7" className="bg-linear-to-br from-deep-violet/50 to-card relative overflow-hidden">
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
              // pipeline.justDoIt not yet implemented — placeholder
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
              disabled={!prompt.trim()}
              className="px-5 py-3 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.4)] hover:shadow-[0_6px_24px_rgba(124,58,237,0.5)] hover:-translate-y-0.5 flex items-center gap-2"
            >
              <Sparkles size={14} />
              Go
            </button>
          </form>
        </Card>

        {/* Issue State Breakdown */}
        <Card padding="p-6">
          <h3 className="text-sm font-semibold text-white">Issues by state</h3>
          <p className="text-xs text-slate-500 mb-5">Current distribution</p>
          <div className="space-y-3">
            {states.map((s) => {
              const count = stateCounts.get(s.id) ?? 0;
              const pct = issues.length > 0 ? Math.round((count / issues.length) * 100) : 0;
              return (
                <div key={s.id} className="flex items-center gap-3">
                  <CatalogBadge displayName={s.displayName} color={s.color} />
                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: s.color }}
                    />
                  </div>
                  <span className="text-xs font-mono text-slate-400 w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Bento row: Recent Pipeline Runs (empty state) + Right column */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {/* Recent Pipeline Runs — endpoint not yet available */}
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
          <div className="px-6 pb-6">
            <EmptyState
              title="No pipeline runs yet"
              description="Pipeline execution engine is not yet wired. Use 'Just Do It' once available."
            />
          </div>
        </Card>

        {/* Right column: Open Issues sidebar */}
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
  );
}
