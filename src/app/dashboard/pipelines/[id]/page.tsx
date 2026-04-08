'use client';

import Link from 'next/link';
import { use } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { trpc } from '@/lib/trpc/client';

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const runQuery = trpc.pipeline.getRun.useQuery(
    { id },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === 'running' || status === 'pending' ? 2000 : false;
      },
    }
  );

  const cancelRun = trpc.pipeline.cancelRun.useMutation({
    onSuccess: () => runQuery.refetch(),
  });

  const approveStage = trpc.pipeline.approveStage.useMutation({
    onSuccess: () => runQuery.refetch(),
  });

  const rejectStage = trpc.pipeline.rejectStage.useMutation({
    onSuccess: () => runQuery.refetch(),
  });

  const run = runQuery.data;

  if (runQuery.isLoading) {
    return <div className="text-muted py-8 text-center">Loading...</div>;
  }

  if (!run) {
    return <div className="text-muted py-8 text-center">Run not found</div>;
  }

  const stageRuns = run.stageRuns ?? [];

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/pipelines"
          className="text-xs text-muted hover:text-foreground"
        >
          &larr; Back to Runs
        </Link>
      </div>

      {/* Run Header */}
      <div className="bg-sidebar border border-sidebar-border rounded-lg p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold">Pipeline Run</h2>
            <p className="text-xs text-muted font-mono mt-1">{run.id}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={run.status} />
            {(run.status === 'running' || run.status === 'pending') && (
              <button
                type="button"
                onClick={() => cancelRun.mutate({ id: run.id })}
                disabled={cancelRun.isPending}
                className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm rounded-md transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="flex gap-4 mt-3 text-xs text-muted">
          {run.startedAt && (
            <span>Started: {new Date(run.startedAt).toLocaleString()}</span>
          )}
          {run.completedAt && (
            <span>Completed: {new Date(run.completedAt).toLocaleString()}</span>
          )}
          <span>Cost: ${run.totalCostUsd ?? '0.00'}</span>
        </div>
      </div>

      {/* Stage Timeline */}
      <div>
        <h3 className="text-sm font-medium text-muted mb-3">Stages</h3>
        <div className="space-y-3">
          {stageRuns.map((sr) => (
            <StageRunCard
              key={sr.id}
              stageRun={sr}
              onApprove={() => approveStage.mutate({ stageRunId: sr.id })}
              onRework={() =>
                rejectStage.mutate({
                  stageRunId: sr.id,
                  verdict: 'rework',
                })
              }
              onAbort={() =>
                rejectStage.mutate({
                  stageRunId: sr.id,
                  verdict: 'abort',
                })
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
  harness: string | null;
  costUsd: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
  pipelineStage: {
    name: string;
    sortOrder: number;
    gateMode: string | null;
  };
  events: Array<{
    id: string;
    type: string;
    payload?: unknown;
    timestamp: string | Date;
  }>;
}

function StageRunCard({
  stageRun,
  onApprove,
  onRework,
  onAbort,
  isActing,
}: {
  stageRun: StageRunData;
  onApprove: () => void;
  onRework: () => void;
  onAbort: () => void;
  isActing: boolean;
}) {
  const stage = stageRun.pipelineStage;
  const isGatePending = stageRun.status === 'gate_pending';
  const isActive =
    stageRun.status === 'running' || stageRun.status === 'gate_pending';

  return (
    <div
      className={`bg-sidebar border rounded-lg p-4 ${
        isActive ? 'border-accent/50' : 'border-sidebar-border'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted w-6 text-right">
            {stage.sortOrder}
          </span>
          <span className="font-medium capitalize">{stage.name}</span>
          <StatusBadge status={stageRun.status} />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          {stageRun.provider && <span>{stageRun.provider}</span>}
          {stageRun.model && <span>/ {stageRun.model}</span>}
          {stageRun.costUsd && <span>${stageRun.costUsd}</span>}
        </div>
      </div>

      {/* Gate Approval UI */}
      {isGatePending && (
        <div className="mt-3 pt-3 border-t border-sidebar-border flex items-center gap-2">
          <span className="text-xs text-muted">
            Gate ({stage.gateMode ?? 'auto'}):
          </span>
          <button
            type="button"
            onClick={onApprove}
            disabled={isActing}
            className="px-3 py-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 text-xs rounded-md transition-colors disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={onRework}
            disabled={isActing}
            className="px-3 py-1 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 text-xs rounded-md transition-colors disabled:opacity-50"
          >
            Rework
          </button>
          <button
            type="button"
            onClick={onAbort}
            disabled={isActing}
            className="px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs rounded-md transition-colors disabled:opacity-50"
          >
            Abort
          </button>
        </div>
      )}

      {/* Events / Transcript */}
      {stageRun.events.length > 0 && (
        <div className="mt-3 pt-3 border-t border-sidebar-border">
          <div className="max-h-48 overflow-y-auto space-y-1 font-mono text-xs">
            {stageRun.events.map((event) => (
              <div key={event.id} className="flex gap-2">
                <span className="text-muted/50 whitespace-nowrap">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-muted">{event.type}</span>
                <span className="text-foreground/70 truncate">
                  {formatEventPayload(event.payload)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function formatEventPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const obj = payload as Record<string, unknown>;
  if (obj.from && obj.to) return `${obj.from} \u2192 ${obj.to}`;
  if (obj.output) return String(obj.output).slice(0, 200);
  if (obj.error) return String(obj.error);
  const str = JSON.stringify(payload);
  return str.length > 100 ? `${str.slice(0, 100)}...` : str;
}
