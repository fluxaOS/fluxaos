'use client';

import { Filter, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Card } from '@/components/card';
import { CatalogBadge } from '@/components/catalog-badge';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { SkeletonTable } from '@/components/skeleton';
import { StatCard } from '@/components/stat-card';
import { trpc } from '@/lib/trpc/client';

// ─── Lifecycle filter (Open / Closed / All) ─────────────────────────────────

type LifecycleFilter = 'open' | 'closed' | 'all';

export function IssueListClient({
  projectId,
  basePath,
}: {
  projectId: string;
  basePath: string;
}) {
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>('open');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // ── Catalog queries ──────────────────────────────────────────────────────
  const typesQuery = trpc.issueCatalog.types.list.useQuery({ projectId });
  const statesQuery = trpc.issueCatalog.states.list.useQuery({ projectId });
  const prioritiesQuery = trpc.issueCatalog.priorities.list.useQuery({
    projectId,
  });

  const types = typesQuery.data ?? [];
  const states = statesQuery.data ?? [];
  const priorities = prioritiesQuery.data ?? [];

  // Build lookup maps for rendering badges
  const typeMap = new Map(types.map((t) => [t.id, t]));
  const stateMap = new Map(states.map((s) => [s.id, s]));
  const priorityMap = new Map(priorities.map((p) => [p.id, p]));

  // ── Issue query with filters ─────────────────────────────────────────────
  const issuesQuery = trpc.issue.list.useQuery({
    projectId,
    ...(lifecycle !== 'all' && { isClosed: lifecycle === 'closed' }),
    ...(typeFilter !== 'all' && { typeId: typeFilter }),
    ...(stateFilter !== 'all' && { stateId: stateFilter }),
    ...(priorityFilter !== 'all' && { priorityId: priorityFilter }),
    ...(searchTerm.trim() && { search: searchTerm.trim() }),
  });

  const issues = issuesQuery.data ?? [];

  // R-EPIC: one bulk query returns { [parentId]: openCount } for every
  // parent in the project — supports "↳ (N open)" indicators without
  // per-row roundtrips.
  const openChildCountsQuery = trpc.issue.openChildCountsByProject.useQuery({
    projectId,
  });
  const openChildCounts = openChildCountsQuery.data ?? {};

  // ── Stat counts from fetched issues ──────────────────────────────────────
  const _openCount = issues.filter((i) => !i.isClosed).length;
  const _closedCount = issues.filter((i) => i.isClosed).length;

  // Count issues per state for stat cards (using full unfiltered query when lifecycle=all)
  const allIssuesQuery = trpc.issue.list.useQuery({ projectId });
  const allIssues = allIssuesQuery.data ?? [];
  const totalOpen = allIssues.filter((i) => !i.isClosed).length;
  const totalClosed = allIssues.filter((i) => i.isClosed).length;

  const catalogsLoading =
    typesQuery.isLoading || statesQuery.isLoading || prioritiesQuery.isLoading;
  const isLoading = issuesQuery.isLoading || catalogsLoading;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Issues"
        description="Track and manage project issues through the pipeline"
        action={
          <Link
            href={`${basePath}/issues/new`}
            className="px-4 py-2 bg-electric-violet hover:bg-accent-hover text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.3)] hover:shadow-[0_6px_24px_rgba(124,58,237,0.4)]"
          >
            New Issue
          </Link>
        }
      />

      {/* Stat summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total" value={allIssues.length} accent="violet" />
        <StatCard label="Open" value={totalOpen} accent="blue" />
        <StatCard label="Closed" value={totalClosed} accent="green" />
        <StatCard label="Filtered" value={issues.length} accent="amber" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter size={14} className="text-slate-500" />

        {/* Lifecycle filter */}
        <select
          value={lifecycle}
          onChange={(e) => setLifecycle(e.target.value as LifecycleFilter)}
          className="bg-card border border-card-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-electric-violet/30"
        >
          <option value="all">All Issues</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>

        {/* State filter (from catalog) */}
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="bg-card border border-card-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-electric-violet/30"
        >
          <option value="all">All States</option>
          {states.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
            </option>
          ))}
        </select>

        {/* Type filter (from catalog) */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-card border border-card-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-electric-violet/30"
        >
          <option value="all">All Types</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayName}
            </option>
          ))}
        </select>

        {/* Priority filter (from catalog) */}
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="bg-card border border-card-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-electric-violet/30"
        >
          <option value="all">All Priorities</option>
          {priorities.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>

        {/* Search */}
        <div className="relative ml-auto">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search issues..."
            className="bg-card border border-card-border rounded-lg pl-8 pr-3 py-1.5 text-sm text-foreground placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-violet/30 w-48"
          />
        </div>
      </div>

      {/* Issue Table */}
      {isLoading ? (
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
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  #
                </th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Title
                </th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Type
                </th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  State
                </th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Priority
                </th>
                <th className="px-6 pt-5 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {issues.map((iss) => {
                const typeInfo = typeMap.get(iss.typeId);
                const stateInfo = stateMap.get(iss.stateId);
                const priorityInfo = priorityMap.get(iss.priorityId);

                return (
                  <tr
                    key={iss.id}
                    className={`border-t border-slate-700/15 hover:bg-white/[0.02] transition-colors ${
                      iss.isClosed ? 'opacity-60' : ''
                    }`}
                  >
                    <td className="px-6 py-3.5 text-xs text-slate-500 font-mono">
                      {iss.number}
                    </td>
                    <td className="px-6 py-3.5">
                      <Link
                        href={`${basePath}/issues/${iss.number}`}
                        className={`text-slate-200 font-medium hover:text-white transition-colors ${
                          iss.isClosed ? 'line-through' : ''
                        }`}
                      >
                        {iss.parentIssueId && (
                          <span
                            className="text-slate-500 mr-1"
                            title="Child of another issue"
                          >
                            ↳
                          </span>
                        )}
                        {iss.title}
                        {openChildCounts[iss.id] > 0 && (
                          <span className="ml-2 text-[10px] text-electric-violet font-normal">
                            ({openChildCounts[iss.id]} open)
                          </span>
                        )}
                      </Link>
                      {iss.isClosed && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-700/40 text-slate-400">
                          Closed
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3.5">
                      {typeInfo ? (
                        <CatalogBadge
                          displayName={typeInfo.displayName}
                          color={typeInfo.color}
                        />
                      ) : (
                        <span className="text-xs text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5">
                      {stateInfo ? (
                        <CatalogBadge
                          displayName={stateInfo.displayName}
                          color={stateInfo.color}
                        />
                      ) : (
                        <span className="text-xs text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5">
                      {priorityInfo ? (
                        <CatalogBadge
                          displayName={priorityInfo.displayName}
                          color={priorityInfo.color}
                        />
                      ) : (
                        <span className="text-xs text-slate-500">-</span>
                      )}
                    </td>
                    <td className="px-6 py-3.5 text-xs text-slate-500">
                      {new Date(iss.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
