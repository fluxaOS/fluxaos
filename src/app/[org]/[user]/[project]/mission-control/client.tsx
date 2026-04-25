'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Activity, Clock, ExternalLink, GitPullRequest, ListChecks, Play } from 'lucide-react';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { trpc } from '@/lib/trpc/client';
import { registry } from '@/config/registry';
import type { RealtimeProvider } from '@/core/ports/realtime';

function formatRelative(d: string | Date | null | undefined, nowMs: number): string {
  if (!d) return '–';
  const t = new Date(d).getTime();
  const ms = Math.max(0, nowMs - t);
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function formatDuration(start: string | Date | null, end: string | Date | null): string {
  if (!start || !end) return '–';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return '–';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return '–';
  return new Date(d).toLocaleString();
}

export function MissionControlClient({
  projectId,
  projectName,
  basePath,
}: {
  projectId: string;
  projectName: string;
  basePath: string;
}) {
  const utils = trpc.useUtils();
  const summaryQuery = trpc.mission.summary.useQuery({ projectId });

  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Realtime: invalidate the summary query whenever the daemon writes to
  // pipeline_run or the deploy bridge writes to issue_pull_request. No
  // polling fallback per project memory.
  useEffect(() => {
    const realtime = registry.get<RealtimeProvider>('realtime');

    const onPipelineChange = () => {
      utils.mission.summary.invalidate({ projectId });
    };
    const onPrInsert = () => {
      utils.mission.summary.invalidate({ projectId });
    };

    const unsubInsert = realtime.subscribeToTable<unknown>(
      `mission-pipeline-run-insert-${projectId}`,
      'pipeline_run',
      'INSERT',
      onPipelineChange,
    );
    const unsubUpdate = realtime.subscribeToTable<unknown>(
      `mission-pipeline-run-update-${projectId}`,
      'pipeline_run',
      'UPDATE',
      onPipelineChange,
    );
    const unsubPr = realtime.subscribeToTable<unknown>(
      `mission-issue-pr-insert-${projectId}`,
      'issue_pull_request',
      'INSERT',
      onPrInsert,
    );

    return () => {
      unsubInsert();
      unsubUpdate();
      unsubPr();
    };
  }, [projectId, utils]);

  const data = summaryQuery.data;
  const pending = data?.pendingRuns ?? [];
  const running = data?.runningRuns ?? [];
  const terminal = data?.recentTerminal ?? [];
  const prs = data?.recentPullRequests ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mission control"
        description={`Live daemon activity for ${projectName}`}
      />

      {/* Section 1: Queue depth */}
      <Card padding="p-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <ListChecks size={16} className="text-amber-400" />
              Queue depth
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Pipeline runs awaiting daemon pickup
            </p>
          </div>
          <span className="text-[42px] font-extrabold text-amber-400 leading-none font-mono">
            {pending.length}
          </span>
        </div>
        {pending.length === 0 ? (
          <EmptyState
            title="Queue is empty — waiting for new runs"
            icon={ListChecks}
          />
        ) : (
          <ul className="divide-y divide-slate-700/20" aria-label="Pending runs">
            {pending.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between py-3 text-sm"
              >
                <div className="min-w-0">
                  <Link
                    href={`${basePath}/pipelines/${p.id}`}
                    className="text-slate-200 font-medium hover:text-white transition-colors truncate"
                  >
                    {p.pipelineName}
                  </Link>
                  <p className="text-xs text-slate-500 truncate">
                    {p.issueTitle || '(no issue)'}
                  </p>
                </div>
                <span className="text-xs text-slate-500 font-mono whitespace-nowrap ml-4">
                  queued {formatRelative(p.createdAt, now)} ago
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Section 2: In-flight */}
      <Card padding="p-6">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Activity size={16} className="text-sky-400" />
              In-flight runs
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Pipeline runs the daemon is currently driving
            </p>
          </div>
          <span className="text-[42px] font-extrabold text-sky-400 leading-none font-mono">
            {running.length}
          </span>
        </div>
        {running.length === 0 ? (
          <EmptyState title="No runs in flight" icon={Activity} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" aria-label="Running runs">
            {running.map((r) => (
              <Link
                key={r.run.id}
                href={`${basePath}/pipelines/${r.run.id}`}
                className="block rounded-lg border border-slate-700/30 bg-slate-900/40 p-4 hover:bg-slate-900/60 hover:border-slate-700/60 transition-colors"
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-semibold text-white truncate">
                    {r.run.pipelineName}
                  </span>
                  <span className="text-[10px] font-mono text-slate-600 whitespace-nowrap ml-3">
                    {r.run.id.slice(0, 8)}
                  </span>
                </div>
                <p className="text-xs text-slate-400 truncate mt-0.5">
                  {r.run.issueTitle || '(no issue)'}
                </p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  {r.currentStage ? (
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">
                        Stage
                      </span>
                      <span className="text-xs text-slate-200 font-medium truncate">
                        {r.currentStage.name}
                      </span>
                      <StatusBadge status={r.currentStage.status} />
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">starting…</span>
                  )}
                  <span className="text-xs font-mono text-slate-500 whitespace-nowrap flex items-center gap-1">
                    <Clock size={11} />
                    {formatRelative(r.run.startedAt, now)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* Section 3: Recent terminal */}
      <Card padding="p-0">
        <div className="px-6 pt-5 pb-4 flex items-baseline justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Play size={16} className="text-emerald-400" />
              Recent terminal runs
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Last 10 completed/failed/cancelled
            </p>
          </div>
          <Link
            href={`${basePath}/pipelines`}
            className="text-xs text-soft-violet hover:text-electric-violet font-medium transition-colors"
          >
            View all &rarr;
          </Link>
        </div>
        {terminal.length === 0 ? (
          <div className="px-6 pb-6">
            <EmptyState title="No terminal runs yet" icon={Play} />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Pipeline
                </th>
                <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Issue
                </th>
                <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Final stage
                </th>
                <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Status
                </th>
                <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Started
                </th>
                <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Duration
                </th>
              </tr>
            </thead>
            <tbody>
              {terminal.map((t) => (
                <tr
                  key={t.run.id}
                  className="border-t border-slate-700/15 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-6 py-3.5">
                    <Link
                      href={`${basePath}/pipelines/${t.run.id}`}
                      className="text-slate-200 font-medium hover:text-white transition-colors"
                    >
                      {t.run.pipelineName}
                    </Link>
                  </td>
                  <td className="px-6 py-3.5 text-xs text-slate-400 max-w-[24ch] truncate">
                    {t.run.issueTitle || '–'}
                  </td>
                  <td className="px-6 py-3.5 text-xs text-slate-400">
                    {t.finalStage?.name ?? '–'}
                  </td>
                  <td className="px-6 py-3.5">
                    <StatusBadge status={t.run.status} />
                  </td>
                  <td className="px-6 py-3.5 text-xs text-slate-500 whitespace-nowrap">
                    {formatDateTime(t.run.startedAt)}
                  </td>
                  <td className="px-6 py-3.5 text-xs font-mono text-slate-400 whitespace-nowrap">
                    {formatDuration(t.run.startedAt, t.run.completedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Section 4: Recent PRs */}
      <Card padding="p-0">
        <div className="px-6 pt-5 pb-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <GitPullRequest size={16} className="text-soft-violet" />
            Recent pull requests
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Last 10 PRs opened by the deploy bridge
          </p>
        </div>
        {prs.length === 0 ? (
          <div className="px-6 pb-6">
            <EmptyState title="No PRs opened yet" icon={GitPullRequest} />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  PR
                </th>
                <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Issue
                </th>
                <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  State
                </th>
                <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Branch
                </th>
                <th className="px-6 pb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  Created
                </th>
                <th className="px-6 pb-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {prs.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-slate-700/15 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-6 py-3.5">
                    <span className="text-slate-200 font-medium">
                      #{p.prNumber} {p.title}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-xs text-slate-400 max-w-[24ch] truncate">
                    {p.issueTitle || '–'}
                  </td>
                  <td className="px-6 py-3.5">
                    <StatusBadge status={p.state} />
                  </td>
                  <td className="px-6 py-3.5 text-xs font-mono text-slate-400">
                    {p.headBranch}
                  </td>
                  <td className="px-6 py-3.5 text-xs text-slate-500 whitespace-nowrap">
                    {formatDateTime(p.createdAt)}
                  </td>
                  <td className="px-6 py-3.5">
                    <a
                      href={p.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-400 hover:text-white transition-colors inline-flex"
                      aria-label="Open PR on GitHub"
                    >
                      <ExternalLink size={14} />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
