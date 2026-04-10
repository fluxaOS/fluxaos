'use client';

import Link from 'next/link';
import { use } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Check, RotateCcw, XOctagon } from 'lucide-react';
import { Card } from '@/components/card';
import { StatusBadge } from '@/components/status-badge';
import { trpc } from '@/lib/trpc/client';

function useBasePath() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  return segments.length >= 3 ? `/${segments[0]}/${segments[1]}/${segments[2]}` : '/';
}

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const basePath = useBasePath();

  const runQuery = trpc.pipeline.runs.get.useQuery(
    { id },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'running' || status === 'queued' ? 2000 : false;
      },
    },
  );

  const cancelRun = trpc.pipeline.runs.cancel.useMutation({
    onSuccess: () => runQuery.refetch(),
  });

  const run = runQuery.data;

  if (runQuery.isLoading) {
    return <div className="text-slate-500 py-8 text-center">Loading...</div>;
  }

  if (!run) {
    return <div className="text-slate-500 py-8 text-center">Run not found</div>;
  }

  const stageRuns = run.stageRuns ?? [];

  return (
    <div className="space-y-6">
      <Link
        href={`${basePath}/pipelines`}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        <ArrowLeft size={14} />
        Back to runs
      </Link>

      {/* Run Header */}
      <Card hover={false} padding="p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Pipeline run</h2>
            <p className="text-xs text-slate-500 font-mono mt-1">{run.id}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={run.status} />
            {(run.status === 'running' || run.status === 'queued') && (
              <button
                type="button"
                onClick={() => cancelRun.mutate({ id: run.id })}
                disabled={cancelRun.isPending}
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-red-400 border border-red-400/20 bg-red-400/10 hover:bg-red-400/20 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-5 mt-3 text-xs text-slate-500">
          {run.startedAt && (
            <span>Started: {new Date(run.startedAt).toLocaleString()}</span>
          )}
          {run.completedAt && (
            <span>Completed: {new Date(run.completedAt).toLocaleString()}</span>
          )}
          <span>Cost: <span className="font-mono text-slate-400">${run.totalCostUsd ?? '0.00'}</span></span>
        </div>
      </Card>

      {/* Stage Timeline */}
      <div>
        <h3 className="text-sm font-semibold text-slate-400 mb-4">Stages</h3>
        <div className="space-y-0">
          {stageRuns.map((sr: typeof stageRuns[number], idx: number) => (
            <StageRunCard
              key={sr.id}
              stageRun={sr}
              isLast={idx === stageRuns.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StageRunCard({
  stageRun,
  isLast,
}: {
  stageRun: {
    id: string;
    status: string;
    provider: string | null;
    model: string | null;
    costUsd: string | null;
    tokensIn: number | null;
    tokensOut: number | null;
    startedAt: string | Date | null;
    completedAt: string | Date | null;
    pipelineStageId: string;
  };
  isLast: boolean;
}) {
  const isCompleted = stageRun.status === 'completed';
  const isActive = stageRun.status === 'running' || stageRun.status === 'launching';
  const isPending = stageRun.status === 'pending' || stageRun.status === 'queued';

  const stepColor = isCompleted
    ? 'bg-emerald-400/15 border-emerald-400/40 text-emerald-400'
    : isActive
      ? 'bg-electric-violet/20 border-soft-violet/60 text-soft-violet'
      : 'bg-white/[0.03] border-slate-700/30 text-slate-500';

  return (
    <div className="relative">
      {!isLast && (
        <div className="absolute left-[21px] top-[54px] bottom-[-2px] w-0.5 bg-slate-700/20" />
      )}

      <div className="flex gap-4 mb-3">
        <div className={`w-[44px] h-[44px] rounded-full border-[1.5px] flex items-center justify-center flex-shrink-0 ${stepColor}`}>
          {isCompleted ? (
            <Check size={18} strokeWidth={2.5} />
          ) : (
            <span className="text-sm font-bold">&bull;</span>
          )}
        </div>

        <div
          className={`flex-1 card-static p-4 ${
            isActive
              ? 'border-electric-violet/25 shadow-[0_4px_6px_rgba(0,0,0,0.15),0_10px_30px_rgba(0,0,0,0.25),0_0_20px_rgba(124,58,237,0.08)]'
              : ''
          } ${isPending ? 'opacity-50' : ''}`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-semibold text-white font-mono text-xs">
                {stageRun.pipelineStageId.slice(0, 8)}
              </span>
              <StatusBadge status={stageRun.status} />
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              {stageRun.provider && <span>{stageRun.provider}</span>}
              {stageRun.model && <span>/ {stageRun.model}</span>}
              {stageRun.costUsd && Number(stageRun.costUsd) > 0 && (
                <span className="font-mono text-slate-400">${stageRun.costUsd}</span>
              )}
            </div>
          </div>

          {stageRun.tokensIn != null && stageRun.tokensIn > 0 && (
            <p className="text-[11px] text-slate-600 mt-1.5">
              {(stageRun.tokensIn / 1000).toFixed(1)}k in &middot;{' '}
              {((stageRun.tokensOut ?? 0) / 1000).toFixed(1)}k out
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
