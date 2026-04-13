'use client';

interface StageTimelineItem {
  id: string;
  name: string;
  status: string;
  attempt?: number;
  durationSec?: number | null;
}

interface StageTimelineProps {
  stages: StageTimelineItem[];
  selectedStageId: string | null;
  onSelectStage: (id: string) => void;
}

const dotColors: Record<string, string> = {
  completed: 'bg-emerald-400',
  running:   'bg-sky-400 animate-pulse',
  launching: 'bg-sky-400 animate-pulse',
  pending:   'bg-amber-400',
  hold:      'bg-amber-400',
  failed:    'bg-red-400',
  queued:    'bg-slate-500',
  cancelled: 'bg-slate-500',
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function StageTimeline({ stages, selectedStageId, onSelectStage }: StageTimelineProps) {
  if (stages.length === 0) {
    return <p className="text-xs text-slate-500">No stages.</p>;
  }

  return (
    <div className="space-y-1">
      {stages.map((stage, idx) => {
        const isSelected = stage.id === selectedStageId;
        const dotColor = dotColors[stage.status] ?? 'bg-slate-500';
        const isLast = idx === stages.length - 1;

        return (
          <button
            key={stage.id}
            type="button"
            onClick={() => onSelectStage(stage.id)}
            className={`relative w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isSelected
                ? 'bg-electric-violet/15 ring-1 ring-electric-violet/40'
                : 'hover:bg-white/[0.04]'
            }`}
          >
            {/* Connecting line */}
            {!isLast && (
              <div className="absolute left-[19px] top-[28px] bottom-[-4px] w-px bg-slate-700/30" />
            )}

            {/* Status dot */}
            <span className={`relative w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />

            {/* Stage info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium text-slate-200 capitalize truncate">
                  {stage.name}
                </span>
                {(stage.attempt ?? 1) > 1 && (
                  <span className="text-[10px] text-slate-500">
                    attempt {stage.attempt}
                  </span>
                )}
              </div>
              {stage.durationSec != null && (
                <span className="text-[10px] text-slate-500">
                  {formatDuration(stage.durationSec)}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
