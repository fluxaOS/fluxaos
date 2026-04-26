'use client';

import { PIPELINE_RUN_STATUS, STAGE_RUN_STATUS } from '@/core/constants';

const statusConfig: Record<
  string,
  { pill: string; dot: string; label: string }
> = {
  [PIPELINE_RUN_STATUS.running]: {
    pill: 'bg-sky-400/10 text-sky-400',
    dot: 'bg-sky-400 animate-pulse',
    label: 'Running',
  },
  [PIPELINE_RUN_STATUS.queued]: {
    pill: 'bg-amber-400/10 text-amber-400',
    dot: 'bg-amber-400',
    label: 'Queued',
  },
  [PIPELINE_RUN_STATUS.completed]: {
    pill: 'bg-emerald-400/10 text-emerald-400',
    dot: 'bg-emerald-400',
    label: 'Completed',
  },
  [PIPELINE_RUN_STATUS.failed]: {
    pill: 'bg-red-400/10 text-red-400',
    dot: 'bg-red-400',
    label: 'Failed',
  },
  [PIPELINE_RUN_STATUS.cancelled]: {
    pill: 'bg-slate-400/10 text-slate-400',
    dot: 'bg-slate-400',
    label: 'Cancelled',
  },
  [STAGE_RUN_STATUS.pending]: {
    pill: 'bg-amber-400/10 text-amber-400',
    dot: 'bg-amber-400',
    label: 'Pending',
  },
};

const fallback = {
  pill: 'bg-slate-400/10 text-slate-400',
  dot: 'bg-slate-400',
  label: 'Unknown',
};

interface PipelineStatusBadgeProps {
  status: string;
  /** Optional stage name suffix, e.g. "Running - implement" */
  stage?: string | null;
}

export function PipelineStatusBadge({
  status,
  stage,
}: PipelineStatusBadgeProps) {
  const cfg = statusConfig[status] ?? fallback;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${cfg.pill}`}
    >
      <span className={`w-[7px] h-[7px] rounded-full ${cfg.dot}`} />
      {cfg.label}
      {stage && <span className="font-normal opacity-70">&mdash; {stage}</span>}
    </span>
  );
}
