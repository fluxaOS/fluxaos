const colorMap: Record<string, { pill: string; dot: string }> = {
  // Pipeline run statuses
  pending: { pill: 'bg-amber-400/10 text-amber-400', dot: 'bg-amber-400 dot-glow-amber' },
  running: { pill: 'bg-sky-400/10 text-sky-400', dot: 'bg-sky-400 dot-glow-blue' },
  completed: { pill: 'bg-emerald-400/10 text-emerald-400', dot: 'bg-emerald-400 dot-glow-green' },
  failed: { pill: 'bg-red-400/10 text-red-400', dot: 'bg-red-400 dot-glow-red' },
  cancelled: { pill: 'bg-slate-400/10 text-slate-400', dot: 'bg-slate-400' },
  // Stage run statuses
  queued: { pill: 'bg-amber-400/10 text-amber-400', dot: 'bg-amber-400 dot-glow-amber' },
  gate_pending: { pill: 'bg-soft-violet/10 text-soft-violet', dot: 'bg-soft-violet dot-glow-violet' },
  rework: { pill: 'bg-orange-400/10 text-orange-400', dot: 'bg-orange-400 dot-glow-amber' },
  skipped: { pill: 'bg-slate-400/10 text-slate-400', dot: 'bg-slate-400' },
  // Issue states
  open: { pill: 'bg-sky-400/10 text-sky-400', dot: 'bg-sky-400 dot-glow-blue' },
  in_progress: { pill: 'bg-amber-400/10 text-amber-400', dot: 'bg-amber-400 dot-glow-amber' },
  blocked: { pill: 'bg-red-400/10 text-red-400', dot: 'bg-red-400 dot-glow-red' },
  closed: { pill: 'bg-slate-400/10 text-slate-400', dot: 'bg-slate-400' },
  // Issue priorities
  low: { pill: 'bg-slate-400/10 text-slate-400', dot: 'bg-slate-400' },
  medium: { pill: 'bg-sky-400/10 text-sky-400', dot: 'bg-sky-400 dot-glow-blue' },
  high: { pill: 'bg-orange-400/10 text-orange-400', dot: 'bg-orange-400 dot-glow-amber' },
  critical: { pill: 'bg-red-400/10 text-red-400', dot: 'bg-red-400 dot-glow-red' },
};

const fallback = { pill: 'bg-slate-400/10 text-slate-400', dot: 'bg-slate-400' };

export function StatusBadge({ status }: { status: string }) {
  const colors = colorMap[status] ?? fallback;
  const label = status.replace(/_/g, ' ');

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize ${colors.pill}`}
    >
      <span className={`w-[7px] h-[7px] rounded-full ${colors.dot}`} />
      {label}
    </span>
  );
}
