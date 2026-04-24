'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, XCircle, Loader2 } from 'lucide-react';
import { PipelineStatusBadge } from './PipelineStatusBadge';
import { StageTimeline } from './StageTimeline';
import { LiveOutput } from './LiveOutput';
import { GateResultsPanel } from './GateResultsPanel';
import { trpc } from '@/lib/trpc/client';
import { registry } from '@/config/registry';
import type { RealtimeProvider } from '@/core/ports/realtime';

// ── Types ─────────────────────────────────────────────────────────────────���──

type DetailTab = 'output' | 'gates';

interface RunDetailModalProps {
  runId: string | null;
  onClose: () => void;
  initialStageName?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-slate-700/20 last:border-0">
      <span className="text-xs text-slate-500 w-24 shrink-0">{label}</span>
      <div className="min-w-0 flex-1 text-xs text-slate-300 font-medium">{value ?? '--'}</div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatDateTime(dt: string | Date | null): string {
  if (!dt) return '--';
  return new Date(dt).toLocaleString();
}

// ── Main component ─────────────────────────────────��────────────────────────

export function RunDetailModal({ runId, onClose, initialStageName }: RunDetailModalProps) {
  const [selectedStageRunId, setSelectedStageRunId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('output');
  const [cancelling, setCancelling] = useState(false);
  const [cancellingStage, setCancellingStage] = useState(false);

  const isOpen = runId !== null;

  const runQuery = trpc.pipeline.runs.get.useQuery(
    { id: runId! },
    {
      enabled: isOpen,
    },
  );

  const cancelRunMutation = trpc.pipeline.runs.cancel.useMutation({
    onSuccess: () => runQuery.refetch(),
  });

  const cancelStageMutation = trpc.pipeline.runs.cancelStage.useMutation({
    onSuccess: () => runQuery.refetch(),
  });

  const detail = runQuery.data;
  const stageRuns = detail?.stageRuns ?? [];
  const isRunActive = detail?.status === 'running' || detail?.status === 'queued';

  // Build timeline items from stage runs
  const timelineStages = useMemo(() => {
    return stageRuns.map((sr: typeof stageRuns[number]) => {
      const durationSec = sr.startedAt
        ? sr.completedAt
          ? (new Date(sr.completedAt).getTime() - new Date(sr.startedAt).getTime()) / 1000
          : (Date.now() - new Date(sr.startedAt).getTime()) / 1000
        : null;

      return {
        id: sr.id,
        name: sr.pipelineStage?.name ?? 'Unknown',
        status: sr.status,
        attempt: sr.attempt ?? 1,
        durationSec,
      };
    });
  }, [stageRuns]);

  // Auto-select stage: running > initialStageName > last
  useEffect(() => {
    if (stageRuns.length === 0) return;

    const running = stageRuns.find((sr: typeof stageRuns[number]) =>
      sr.status === 'running' || sr.status === 'launching',
    );
    if (running) {
      setSelectedStageRunId(running.id);
      return;
    }

    if (initialStageName) {
      const match = stageRuns.find((sr: typeof stageRuns[number]) =>
        sr.pipelineStage?.name === initialStageName,
      );
      if (match) {
        setSelectedStageRunId(match.id);
        return;
      }
    }

    setSelectedStageRunId(stageRuns[stageRuns.length - 1].id);
  }, [stageRuns, initialStageName]);

  // Close on Escape key — standard dialog behaviour expected by aria-modal.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Subscribe to Realtime for stage_run AND pipeline_run status changes.
  // Both subscriptions trigger a refetch so the status badge stays current.
  // pipeline_run subscription is required because the orchestrator updates
  // pipeline_run.status AFTER stage_run.status — if only stage_run is watched,
  // the header badge can stay stuck on "Running" after the run completes.
  useEffect(() => {
    if (!isOpen || !runId) return;

    const realtime = registry.get<RealtimeProvider>('realtime');

    const unsubscribeStage = realtime.subscribeToTable<unknown>(
      `run-detail-stage-${runId}`,
      'stage_run',
      '*',
      () => {
        runQuery.refetch();
      },
    );

    const unsubscribePipeline = realtime.subscribeToTable<unknown>(
      `run-detail-pipeline-${runId}`,
      'pipeline_run',
      'UPDATE',
      () => {
        runQuery.refetch();
      },
    );

    return () => {
      unsubscribeStage();
      unsubscribePipeline();
    };
  }, [runId, isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedStageRun = stageRuns.find((sr: typeof stageRuns[number]) => sr.id === selectedStageRunId) ?? null;
  const isSelectedStageActive = selectedStageRun?.status === 'running' || selectedStageRun?.status === 'launching';

  const handleCancelRun = async () => {
    if (!runId) return;
    setCancelling(true);
    try {
      await cancelRunMutation.mutateAsync({ id: runId });
    } finally {
      setCancelling(false);
    }
  };

  const handleCancelStage = async () => {
    if (!selectedStageRunId) return;
    setCancellingStage(true);
    try {
      await cancelStageMutation.mutateAsync({ stageRunId: selectedStageRunId });
    } finally {
      setCancellingStage(false);
    }
  };

  if (!isOpen) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Modal panel */}
      <div
        className="relative w-full flex flex-col max-h-screen lg:max-h-[90vh] lg:max-w-5xl lg:mx-4 bg-slate-900 lg:rounded-2xl border-0 lg:border border-slate-700/40 shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Run detail"
      >
        {/* ── Header ────────────────────���───────────────────────────────── */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-700/40 shrink-0">
          {detail ? (
            <>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-white truncate">
                  Pipeline Run
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">{detail.id}</p>
              </div>
              <PipelineStatusBadge
                status={detail.status}
                stage={selectedStageRun?.pipelineStage?.name}
              />
              {isRunActive && (
                <button
                  type="button"
                  onClick={handleCancelRun}
                  disabled={cancelling}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 border border-red-400/20 bg-red-400/10 hover:bg-red-400/20 transition-colors disabled:opacity-50"
                >
                  {cancelling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  Cancel Run
                </button>
              )}
            </>
          ) : (
            <div className="flex-1 text-sm text-slate-500">
              {runQuery.isLoading ? 'Loading...' : runQuery.error?.message ?? 'Run Detail'}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-2 p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-white/[0.06] transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-hidden">
          {runQuery.isLoading && !detail && (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-electric-violet" />
            </div>
          )}

          {runQuery.error && !detail && (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-red-400">{runQuery.error.message}</p>
            </div>
          )}

          {detail && (
            <>
              {/* Left column: metadata + stage timeline */}
              <div className="w-full lg:w-72 shrink-0 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-700/40 max-h-48 lg:max-h-none overflow-y-auto">
                {/* Run metadata */}
                <div className="px-4 py-4 border-b border-slate-700/40">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    Run Info
                  </h3>
                  <MetaRow label="Trigger" value="manual" />
                  <MetaRow
                    label="Started"
                    value={formatDateTime(detail.startedAt)}
                  />
                  <MetaRow
                    label="Duration"
                    value={
                      detail.startedAt
                        ? formatDuration(
                            detail.completedAt
                              ? (new Date(detail.completedAt).getTime() - new Date(detail.startedAt).getTime()) / 1000
                              : (Date.now() - new Date(detail.startedAt).getTime()) / 1000,
                          )
                        : null
                    }
                  />
                  {detail.totalCostUsd && Number(detail.totalCostUsd) > 0 && (
                    <MetaRow
                      label="Cost"
                      value={<span className="font-mono">${detail.totalCostUsd}</span>}
                    />
                  )}
                </div>

                {/* Stage timeline */}
                <div className="px-4 py-4 flex-1">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    Stage Timeline
                  </h3>
                  <StageTimeline
                    stages={timelineStages}
                    selectedStageId={selectedStageRunId}
                    onSelectStage={(id) => {
                      setSelectedStageRunId(id);
                      setActiveTab('output');
                    }}
                  />
                </div>
              </div>

              {/* Right column: stage detail + output */}
              <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
                {selectedStageRun ? (
                  <>
                    {/* Stage header */}
                    <div className="px-6 py-4 border-b border-slate-700/40 shrink-0 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-white">
                          {selectedStageRun.pipelineStage?.name ?? 'Stage'}
                          {(selectedStageRun.attempt ?? 1) > 1 && (
                            <span className="ml-2 text-xs font-normal text-slate-500">
                              attempt {selectedStageRun.attempt}
                            </span>
                          )}
                        </h3>
                        <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                          {selectedStageRun.model && (
                            <span>Model: {selectedStageRun.model}</span>
                          )}
                          {selectedStageRun.startedAt && selectedStageRun.completedAt && (
                            <span>
                              {formatDuration(
                                (new Date(selectedStageRun.completedAt).getTime() -
                                  new Date(selectedStageRun.startedAt).getTime()) / 1000,
                              )}
                            </span>
                          )}
                          {selectedStageRun.exitCode != null && (
                            <span className={`font-mono ${
                              selectedStageRun.exitCode === 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}>
                              exit {selectedStageRun.exitCode}
                            </span>
                          )}
                        </div>
                      </div>
                      {isSelectedStageActive && (
                        <button
                          type="button"
                          onClick={handleCancelStage}
                          disabled={cancellingStage}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 border border-red-400/20 bg-red-400/10 hover:bg-red-400/20 transition-colors disabled:opacity-50"
                        >
                          {cancellingStage ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5" />
                          )}
                          Cancel Stage
                        </button>
                      )}
                    </div>

                    {/* Result / error summary */}
                    <div className="px-6 pt-4 space-y-3">
                      {selectedStageRun.status === 'completed' && (
                        <div className="text-sm text-emerald-400 bg-emerald-400/5 rounded-lg px-3 py-2 border border-emerald-400/20">
                          Stage completed successfully
                        </div>
                      )}
                      {selectedStageRun.status === 'failed' && (
                        <div className="text-sm text-red-400 bg-red-400/5 rounded-lg px-3 py-2 border border-red-400/20 font-mono">
                          Stage failed{selectedStageRun.exitCode != null ? ` (exit ${selectedStageRun.exitCode})` : ''}
                        </div>
                      )}
                    </div>

                    {/* Tab bar */}
                    <div className="flex items-center gap-1 px-6 pt-3 border-b border-slate-700/30">
                      {([
                        { key: 'output' as const, label: 'Output' },
                        { key: 'gates' as const, label: 'Gates' },
                      ]).map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setActiveTab(tab.key)}
                          className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                            activeTab === tab.key
                              ? 'border-electric-violet text-electric-violet'
                              : 'border-transparent text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {/* Tab content */}
                    <div className="flex-1 px-6 py-4 min-h-0">
                      {activeTab === 'output' && (
                        <LiveOutput
                          stageRunId={selectedStageRun.id}
                          isActive={isSelectedStageActive}
                        />
                      )}
                      {activeTab === 'gates' && (
                        <GateResultsPanel stageRunId={selectedStageRun.id} />
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
                    Select a stage to view details.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
