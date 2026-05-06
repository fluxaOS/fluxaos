'use client';

import {
  AlertTriangle,
  CircleDot,
  Loader2,
  Play,
  PowerOff,
  RefreshCw,
  Square,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc/client';

type DaemonState = 'running' | 'stopped' | 'draining' | 'unknown';

function StatusDot({ state }: { state: DaemonState }) {
  const colors: Record<DaemonState, string> = {
    running: 'text-emerald-400',
    stopped: 'text-slate-500',
    draining: 'text-amber-400',
    unknown: 'text-slate-600',
  };
  const labels: Record<DaemonState, string> = {
    running: 'Running',
    stopped: 'Stopped',
    draining: 'Draining',
    unknown: 'Unknown',
  };
  return (
    <span
      className={`flex items-center gap-1.5 text-xs font-medium ${colors[state]}`}
    >
      <CircleDot size={12} />
      {labels[state]}
    </span>
  );
}

function CtrlButton({
  onClick,
  disabled,
  loading,
  icon: Icon,
  label,
  variant = 'default',
}: {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
  icon: React.ElementType;
  label: string;
  variant?: 'default' | 'danger';
}) {
  const base =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const styles =
    variant === 'danger'
      ? 'bg-red-900/40 text-red-300 hover:bg-red-800/60 border border-red-700/40'
      : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700/60 border border-slate-700/40';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${styles}`}
      aria-label={label}
    >
      {loading ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <Icon size={12} />
      )}
      {label}
    </button>
  );
}

export function DaemonControls() {
  const utils = trpc.useUtils();
  const statusQuery = trpc.daemon.status.useQuery(undefined, {
    refetchInterval: 3000,
  });

  const state: DaemonState = statusQuery.data?.state ?? 'unknown';
  const isTransitioning = state === 'draining' || state === 'unknown';

  const startMutation = trpc.daemon.start.useMutation({
    onSettled: () => utils.daemon.status.invalidate(),
  });
  const drainMutation = trpc.daemon.drain.useMutation({
    onSettled: () => utils.daemon.status.invalidate(),
  });
  const restartMutation = trpc.daemon.restart.useMutation({
    onSettled: () => utils.daemon.status.invalidate(),
  });
  const stopMutation = trpc.daemon.stop.useMutation({
    onSettled: () => utils.daemon.status.invalidate(),
  });

  // Stop confirmation state
  const [confirmStop, setConfirmStop] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  function handleStopClick() {
    if (!confirmStop) {
      setConfirmStop(true);
      confirmTimerRef.current = setTimeout(() => setConfirmStop(false), 5000);
      return;
    }
    setConfirmStop(false);
    stopMutation.mutate({ confirm: true });
  }

  const anyLoading =
    startMutation.isPending ||
    drainMutation.isPending ||
    restartMutation.isPending ||
    stopMutation.isPending;

  return (
    <div className="flex items-center gap-4 flex-wrap">
      <StatusDot state={state} />

      <div className="flex items-center gap-2 flex-wrap">
        <CtrlButton
          icon={Play}
          label="Start"
          onClick={() => startMutation.mutate()}
          disabled={state === 'running' || isTransitioning || anyLoading}
          loading={startMutation.isPending}
        />
        <CtrlButton
          icon={RefreshCw}
          label="Restart"
          onClick={() => restartMutation.mutate()}
          disabled={state !== 'running' || anyLoading}
          loading={restartMutation.isPending}
        />
        <CtrlButton
          icon={Square}
          label="Drain"
          onClick={() => drainMutation.mutate()}
          disabled={state !== 'running' || anyLoading}
          loading={drainMutation.isPending}
        />
        <CtrlButton
          icon={confirmStop ? AlertTriangle : PowerOff}
          label={confirmStop ? 'Confirm Kill' : 'Stop'}
          onClick={handleStopClick}
          disabled={state !== 'running' || anyLoading}
          loading={stopMutation.isPending}
          variant="danger"
        />
      </div>

      {confirmStop && (
        <span className="text-xs text-red-400 animate-pulse">
          Kills in-flight stages. Click again to confirm.
        </span>
      )}
    </div>
  );
}
