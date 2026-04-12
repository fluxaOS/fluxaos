'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { VerdictBadge } from './VerdictBadge';
import type { GateMode, RuleGroup } from '@/core/gates/types';

const DEFAULT_CONTEXT = JSON.stringify(
  { exit_code: 0, cost_usd: 0.05, files_changed: 3 },
  null,
  2,
);

export function RuleTestPanel({
  mode,
  rules,
}: {
  mode: GateMode;
  rules: RuleGroup | null;
}) {
  const [contextJson, setContextJson] = useState(DEFAULT_CONTEXT);
  const [parseError, setParseError] = useState<string | null>(null);

  const testMutation = trpc.gate.test.useMutation();

  function handleTest() {
    try {
      const parsed = JSON.parse(contextJson);
      setParseError(null);
      testMutation.mutate({ mode, rules, context: parsed });
    } catch {
      setParseError('Invalid JSON');
    }
  }

  const result = testMutation.data;
  const ruleResults = result?.ruleResults ?? [];

  return (
    <div className="border border-slate-700/30 rounded-xl p-4 bg-slate-800/20 space-y-4">
      <h4 className="text-xs font-semibold text-slate-400">
        Test Gate Rules
      </h4>

      {/* Context input */}
      <div>
        <label className="block text-[11px] text-slate-500 mb-1">
          Mock context (JSON)
        </label>
        <textarea
          value={contextJson}
          onChange={(e) => setContextJson(e.target.value)}
          rows={5}
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-xs font-mono text-foreground focus:outline-none focus:border-soft-violet/60 transition-colors resize-y"
        />
        {parseError && (
          <p className="text-[11px] text-red-400 mt-1">{parseError}</p>
        )}
      </div>

      {/* Test button */}
      <button
        type="button"
        onClick={handleTest}
        disabled={testMutation.isPending}
        className="px-4 py-1.5 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
      >
        {testMutation.isPending ? 'Testing...' : 'Test Rules'}
      </button>

      {/* Error */}
      {testMutation.error && (
        <p className="text-[11px] text-red-400">
          Error: {testMutation.error.message}
        </p>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-3">
          {/* Verdict */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">Verdict:</span>
            <VerdictBadge verdict={result.verdict} />
            <span className="text-[11px] text-slate-500">
              {result.passed ? 'Passed' : 'Failed'}
            </span>
          </div>

          {/* Reason */}
          {result.reason && (
            <p className="text-[11px] text-slate-400 bg-slate-900/50 rounded-lg px-3 py-2 font-mono">
              {result.reason}
            </p>
          )}

          {/* Per-rule results */}
          {ruleResults.length > 0 && (
            <div>
              <h5 className="text-[11px] font-semibold text-slate-500 mb-2">
                Rule Results
              </h5>
              <div className="space-y-1">
                {ruleResults.map((rr, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] ${
                      rr.passed
                        ? 'bg-emerald-400/5 text-emerald-400/80'
                        : 'bg-red-400/5 text-red-400/80'
                    }`}
                  >
                    <span className="font-bold">
                      {rr.passed ? 'PASS' : 'FAIL'}
                    </span>
                    <span className="font-mono text-slate-400">
                      {rr.rule.field}
                    </span>
                    <span className="text-slate-500">{rr.rule.operator}</span>
                    <span className="font-mono text-slate-400">
                      {rr.rule.operator !== 'exists'
                        ? String(rr.rule.value ?? '')
                        : ''}
                    </span>
                    <span className="text-slate-600">|</span>
                    <span className="text-slate-500">actual:</span>
                    <span className="font-mono text-slate-400">
                      {String(rr.actualValue ?? 'undefined')}
                    </span>
                    {rr.rule.label && (
                      <span className="text-slate-600 italic">
                        ({rr.rule.label})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
