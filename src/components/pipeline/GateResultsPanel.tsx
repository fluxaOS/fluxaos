'use client';

import { VerdictBadge } from '@/components/gates/VerdictBadge';
import { trpc } from '@/lib/trpc/client';

interface GateResultsPanelProps {
  stageRunId: string;
}

export function GateResultsPanel({ stageRunId }: GateResultsPanelProps) {
  const gateQuery = trpc.pipeline.runs.gateResults.useQuery(
    { stageRunId },
    { enabled: !!stageRunId }
  );

  const results = gateQuery.data ?? [];

  if (gateQuery.isLoading) {
    return <p className="text-xs text-slate-500">Loading gate results...</p>;
  }

  if (results.length === 0) {
    return <p className="text-xs text-slate-500">No gate results.</p>;
  }

  return (
    <div className="space-y-2">
      {results.map((g: (typeof results)[number]) => {
        const passed = g.passed ?? false;
        const ruleResults = (g.ruleResults ?? []) as Array<{
          field?: string;
          operator?: string;
          expected?: unknown;
          actual?: unknown;
          passed?: boolean;
          label?: string;
        }>;

        return (
          <div
            key={g.id}
            className="rounded-lg border border-slate-700/30 p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
              <VerdictBadge verdict={g.verdict ?? 'proceed'} />
              <span className="text-xs text-slate-400">
                {passed ? 'All rules passed' : 'Some rules failed'}
              </span>
            </div>

            {ruleResults.length > 0 && (
              <div className="space-y-1">
                {ruleResults.map((rule, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${
                      rule.passed
                        ? 'text-emerald-400/80'
                        : 'text-red-400/80 bg-red-400/5'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        rule.passed ? 'bg-emerald-400' : 'bg-red-400'
                      }`}
                    />
                    <span className="font-mono">
                      {rule.field} {rule.operator} {String(rule.expected ?? '')}
                    </span>
                    {rule.label && (
                      <span className="text-slate-500">
                        &mdash; {rule.label}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!passed && g.reason && (
              <p className="text-xs text-red-400/70 pl-2 border-l-2 border-red-400/20">
                {g.reason}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
