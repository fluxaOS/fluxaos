'use client';

import { ArrowLeft, Check, RotateCcw, XOctagon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { use, useState } from 'react';
import { Card } from '@/components/card';
import { VerdictBadge } from '@/components/gates/VerdictBadge';
import { RunDetailModal } from '@/components/pipeline/RunDetailModal';
import { StatusBadge } from '@/components/status-badge';
import { trpc } from '@/lib/trpc/client';

function useBasePath() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  return segments.length >= 3
    ? `/${segments[0]}/${segments[1]}/${segments[2]}`
    : '/';
}

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const basePath = useBasePath();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const runQuery = trpc.pipeline.runs.get.useQuery(
    { id },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'running' || status === 'pending' ? 2000 : false;
      },
    }
  );

  const cancelRun = trpc.pipeline.runs.cancel.useMutation({
    onSuccess: () => runQuery.refetch(),
  });

  const approveStage = trpc.pipeline.runs.approveStage.useMutation({
    onSuccess: () => runQuery.refetch(),
  });

  const rejectStage = trpc.pipeline.runs.rejectStage.useMutation({
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
            {(run.status === 'running' || run.status === 'pending') && (
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
          <span>
            Cost:{' '}
            <span className="font-mono text-slate-400">
              ${run.totalCostUsd ?? '0.00'}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setSelectedRunId(run.id)}
            className="text-soft-violet hover:underline ml-auto"
          >
            View in modal
          </button>
        </div>
      </Card>

      <RunDetailModal
        runId={selectedRunId}
        onClose={() => {
          setSelectedRunId(null);
          runQuery.refetch();
        }}
      />

      {/* Stage Timeline */}
      <div>
        <h3 className="text-sm font-semibold text-slate-400 mb-4">Stages</h3>
        <div className="space-y-0">
          {stageRuns.map((sr: (typeof stageRuns)[number], idx: number) => (
            <StageRunCard
              key={sr.id}
              stageRun={sr}
              isLast={idx === stageRuns.length - 1}
              onApprove={() => approveStage.mutate({ stageRunId: sr.id })}
              onRework={() =>
                rejectStage.mutate({ stageRunId: sr.id, verdict: 'rework' })
              }
              onAbort={() =>
                rejectStage.mutate({ stageRunId: sr.id, verdict: 'abort' })
              }
              isActing={approveStage.isPending || rejectStage.isPending}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface StageRunData {
  id: string;
  status: string;
  provider: string | null;
  model: string | null;
  driver: string | null;
  costUsd: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  pipelineStageId: string;
  pipelineStage: {
    name: string;
    sortOrder: number;
    gateMode: string | null;
  } | null;
  events: Array<{
    id: string;
    type: string;
    payload?: unknown;
    timestamp: string | Date;
  }>;
}

function StageRunCard({
  stageRun,
  isLast,
  onApprove,
  onRework,
  onAbort,
  isActing,
}: {
  stageRun: StageRunData;
  isLast: boolean;
  onApprove: () => void;
  onRework: () => void;
  onAbort: () => void;
  isActing: boolean;
}) {
  const stage = stageRun.pipelineStage;
  const isCompleted = stageRun.status === 'completed';
  const isActive =
    stageRun.status === 'running' || stageRun.status === 'launching';
  const isQueued = stageRun.status === 'queued';
  const isGatePending = stageRun.status === 'pending';

  // Extract gate verdict from events (gate_checked event has verdict in payload)
  const gateEvent = stageRun.events.find((evt) => evt.type === 'gate_checked');
  const gateVerdict =
    gateEvent &&
    typeof gateEvent.payload === 'object' &&
    gateEvent.payload !== null
      ? ((gateEvent.payload as Record<string, unknown>).verdict as
          | string
          | undefined)
      : undefined;

  const stepColor = isCompleted
    ? 'bg-emerald-400/15 border-emerald-400/40 text-emerald-400'
    : isActive || isGatePending
      ? 'bg-electric-violet/20 border-soft-violet/60 text-soft-violet'
      : 'bg-white/[0.03] border-slate-700/30 text-slate-500';

  return (
    <div className="relative">
      {/* Connecting line */}
      {!isLast && (
        <div className="absolute left-[21px] top-[54px] bottom-[-2px] w-0.5 bg-slate-700/20" />
      )}

      <div className="flex gap-4 mb-3">
        {/* Step circle */}
        <div
          className={`w-[44px] h-[44px] rounded-full border-[1.5px] flex items-center justify-center flex-shrink-0 ${stepColor}`}
        >
          {isCompleted ? (
            <Check size={18} strokeWidth={2.5} />
          ) : (
            <span className="text-sm font-bold">{stage?.sortOrder ?? '?'}</span>
          )}
        </div>

        {/* Card */}
        <div
          className={`flex-1 card-static p-4 ${
            isActive || isGatePending
              ? 'border-electric-violet/25 shadow-[0_4px_6px_rgba(0,0,0,0.15),0_10px_30px_rgba(0,0,0,0.25),0_0_20px_rgba(124,58,237,0.08)]'
              : ''
          } ${isQueued ? 'opacity-50' : ''}`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-semibold capitalize text-white">
                {stage?.name ?? 'Unknown'}
              </span>
              <StatusBadge status={stageRun.status} />
              {gateVerdict && <VerdictBadge verdict={gateVerdict} />}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              {stageRun.provider && <span>{stageRun.provider}</span>}
              {stageRun.model && <span>/ {stageRun.model}</span>}
              {stageRun.driver && <span>({stageRun.driver})</span>}
              {stageRun.costUsd && Number(stageRun.costUsd) > 0 && (
                <span className="font-mono text-slate-400">
                  ${stageRun.costUsd}
                </span>
              )}
            </div>
          </div>

          {stageRun.tokensIn != null && stageRun.tokensIn > 0 && (
            <p className="text-[11px] text-slate-600 mt-1.5">
              {(stageRun.tokensIn / 1000).toFixed(1)}k tokens in &middot;{' '}
              {((stageRun.tokensOut ?? 0) / 1000).toFixed(1)}k tokens out
            </p>
          )}

          {/* Gate Approval UI */}
          {isGatePending && (
            <div className="mt-4 pt-4 border-t border-slate-700/20">
              <p className="text-xs text-slate-500 font-medium mb-3">
                Gate ({stage?.gateMode ?? 'auto'}) — awaiting review
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onApprove}
                  disabled={isActing}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-emerald-400 border border-emerald-400/25 bg-emerald-400/10 hover:bg-emerald-400/20 transition-colors disabled:opacity-50"
                >
                  <Check size={14} />
                  Approve
                </button>
                <button
                  type="button"
                  onClick={onRework}
                  disabled={isActing}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-amber-400 border border-amber-400/20 bg-amber-400/10 hover:bg-amber-400/20 transition-colors disabled:opacity-50"
                >
                  <RotateCcw size={14} />
                  Rework
                </button>
                <button
                  type="button"
                  onClick={onAbort}
                  disabled={isActing}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-red-400 border border-red-400/20 bg-red-400/10 hover:bg-red-400/20 transition-colors disabled:opacity-50"
                >
                  <XOctagon size={14} />
                  Abort
                </button>
              </div>
            </div>
          )}

          {/* Events / Transcript */}
          {stageRun.events.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-700/20">
              <div className="max-h-48 overflow-y-auto space-y-1 font-mono text-xs">
                {stageRun.events.map((evt) => (
                  <div key={evt.id} className="flex gap-2">
                    <span className="text-slate-600 whitespace-nowrap">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="text-slate-500">{evt.type}</span>
                    <span className="text-slate-400 truncate">
                      {formatEventPayload(evt.payload)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatEventPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, unknown>;
  if (obj.from && obj.to) return `${obj.from} → ${obj.to}`;
  if (obj.output) return String(obj.output).slice(0, 200);
  if (obj.error) return String(obj.error);
  const str = JSON.stringify(payload);
  return str.length > 100 ? `${str.slice(0, 100)}...` : str;
}
