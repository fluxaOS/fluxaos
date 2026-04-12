'use client';

import type { GateVerdict } from '@/core/gates/types';

const verdictStyles: Record<GateVerdict, { pill: string; dot: string }> = {
  proceed: {
    pill: 'bg-emerald-400/10 text-emerald-400',
    dot: 'bg-emerald-400',
  },
  hold: {
    pill: 'bg-amber-400/10 text-amber-400',
    dot: 'bg-amber-400',
  },
  rework: {
    pill: 'bg-orange-400/10 text-orange-400',
    dot: 'bg-orange-400',
  },
  abort: {
    pill: 'bg-red-400/10 text-red-400',
    dot: 'bg-red-400',
  },
};

const fallback = {
  pill: 'bg-slate-400/10 text-slate-400',
  dot: 'bg-slate-400',
};

export function VerdictBadge({ verdict }: { verdict: string }) {
  const styles = verdictStyles[verdict as GateVerdict] ?? fallback;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize ${styles.pill}`}
    >
      <span className={`w-[7px] h-[7px] rounded-full ${styles.dot}`} />
      {verdict}
    </span>
  );
}
