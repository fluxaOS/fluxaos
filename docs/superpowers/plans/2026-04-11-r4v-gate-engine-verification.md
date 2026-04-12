# Phase R4-V: Gate Engine Verification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **CRITICAL:** This phase uses the enforcement skill chain. Run `/implement` first, which creates a restore point, generates phase snapshot, and scopes work to files listed below. After implementation, run `/review` for Codex adversarial review, then `/deploy` for merge + browser verification.
>
> **EDIT ONLY:** Never use Write on existing files. The Write guard hook enforces this for src/app/, src/components/, src/server/. Use Edit for all changes to existing files.

**Goal:** Verify the committed R4 gate engine works end-to-end by building the missing UI components (rule builder, verdict display, test evaluation) and having the user verify in browser.

**Architecture:** The gate engine backend is 100% complete — pure evaluation engine, DB-backed service, tRPC endpoints (`gate.evaluate`, `gate.test`), 38 integration tests all passing. This phase adds the UI layer that calls those existing endpoints. No backend changes needed.

**Tech Stack:** React 19, Next.js 16 App Router, tRPC React Query hooks, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-04-09-rebuild-spec.md` (Phase R4 section)

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `src/components/gates/RuleBuilder.tsx` | Form component for creating/editing gate rules with operator/value/severity selection |
| `src/components/gates/RuleTestPanel.tsx` | Panel to test rules against mock context JSON and see live verdict |
| `src/components/gates/VerdictBadge.tsx` | Badge component displaying gate verdict (proceed/hold/rework/abort) with color coding |

### Modified Files (EDIT ONLY)

| File | Changes |
|------|---------|
| `src/app/.../settings/page.tsx` | Add rule editor to stage gate configuration (currently only has mode dropdown) |
| `src/app/.../pipelines/[id]/page.tsx` | Display gate verdict on stage cards when gate results exist |

---

## Task 1: VerdictBadge Component

**Files:**
- Create: `src/components/gates/VerdictBadge.tsx`

- [ ] **Step 1: Create the VerdictBadge component**

```tsx
'use client';

type Verdict = 'proceed' | 'hold' | 'rework' | 'abort';

const VERDICT_STYLES: Record<Verdict, { bg: string; text: string; label: string }> = {
  proceed: { bg: 'bg-green-500/10', text: 'text-green-400', label: 'Proceed' },
  hold: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', label: 'Hold' },
  rework: { bg: 'bg-orange-500/10', text: 'text-orange-400', label: 'Rework' },
  abort: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Abort' },
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const style = VERDICT_STYLES[verdict] ?? VERDICT_STYLES.hold;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${style.text.replace('text-', 'bg-')}`} />
      {style.label}
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/gates/VerdictBadge.tsx
git commit -m "feat: VerdictBadge component for gate evaluation results"
```

---

## Task 2: RuleBuilder Component

**Files:**
- Create: `src/components/gates/RuleBuilder.tsx`

- [ ] **Step 1: Create the RuleBuilder component**

This component renders a form for creating gate rules. It supports the full rule structure from `src/core/gates/types.ts`: field, operator, value, severity, onFail action, and label. It also supports AND/OR groups.

```tsx
'use client';

import { useState } from 'react';

const OPERATORS = ['equals', 'not_equals', 'less_than', 'greater_than', 'contains', 'matches', 'in', 'exists'] as const;
const SEVERITIES = ['required', 'warn', 'block'] as const;
const ACTIONS = ['proceed', 'hold', 'rework', 'abort', 'notify', 'escalate'] as const;

type Rule = {
  field: string;
  operator: (typeof OPERATORS)[number];
  value: unknown;
  severity: (typeof SEVERITIES)[number];
  onFail: (typeof ACTIONS)[number];
  label?: string;
};

type RuleGroup = {
  operator: 'AND' | 'OR';
  rules: (Rule | RuleGroup)[];
};

function isRuleGroup(r: Rule | RuleGroup): r is RuleGroup {
  return 'rules' in r;
}

function RuleRow({
  rule,
  onChange,
  onRemove,
}: {
  rule: Rule;
  onChange: (r: Rule) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
      <input
        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-300 w-40"
        placeholder="field (e.g. cost_usd)"
        value={rule.field}
        onChange={(e) => onChange({ ...rule, field: e.target.value })}
      />
      <select
        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-300"
        value={rule.operator}
        onChange={(e) => onChange({ ...rule, operator: e.target.value as Rule['operator'] })}
      >
        {OPERATORS.map((op) => (
          <option key={op} value={op}>{op}</option>
        ))}
      </select>
      <input
        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-300 w-28"
        placeholder="value"
        value={String(rule.value ?? '')}
        onChange={(e) => {
          const v = e.target.value;
          const num = Number(v);
          onChange({ ...rule, value: v === '' ? '' : isNaN(num) ? v : num });
        }}
      />
      <select
        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-300"
        value={rule.severity}
        onChange={(e) => onChange({ ...rule, severity: e.target.value as Rule['severity'] })}
      >
        {SEVERITIES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <select
        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-300"
        value={rule.onFail}
        onChange={(e) => onChange({ ...rule, onFail: e.target.value as Rule['onFail'] })}
      >
        {ACTIONS.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>
      <input
        className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-300 w-32"
        placeholder="label (optional)"
        value={rule.label ?? ''}
        onChange={(e) => onChange({ ...rule, label: e.target.value || undefined })}
      />
      <button
        className="text-red-400 hover:text-red-300 text-sm px-2"
        onClick={onRemove}
      >
        Remove
      </button>
    </div>
  );
}

function GroupEditor({
  group,
  onChange,
  onRemove,
  depth = 0,
}: {
  group: RuleGroup;
  onChange: (g: RuleGroup) => void;
  onRemove?: () => void;
  depth?: number;
}) {
  const addRule = () => {
    onChange({
      ...group,
      rules: [...group.rules, { field: '', operator: 'equals', value: '', severity: 'required', onFail: 'hold' }],
    });
  };

  const addGroup = () => {
    if (depth >= 2) return; // max nesting depth 3
    onChange({
      ...group,
      rules: [...group.rules, { operator: 'AND', rules: [] }],
    });
  };

  const updateItem = (index: number, item: Rule | RuleGroup) => {
    const updated = [...group.rules];
    updated[index] = item;
    onChange({ ...group, rules: updated });
  };

  const removeItem = (index: number) => {
    onChange({ ...group, rules: group.rules.filter((_, i) => i !== index) });
  };

  return (
    <div className={`space-y-2 ${depth > 0 ? 'ml-4 pl-4 border-l-2 border-slate-700/50' : ''}`}>
      <div className="flex items-center gap-2">
        <select
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs font-medium text-slate-300"
          value={group.operator}
          onChange={(e) => onChange({ ...group, operator: e.target.value as 'AND' | 'OR' })}
        >
          <option value="AND">ALL must pass (AND)</option>
          <option value="OR">ANY can pass (OR)</option>
        </select>
        {onRemove && (
          <button className="text-red-400 hover:text-red-300 text-xs" onClick={onRemove}>
            Remove Group
          </button>
        )}
      </div>
      {group.rules.map((item, i) =>
        isRuleGroup(item) ? (
          <GroupEditor
            key={i}
            group={item}
            onChange={(g) => updateItem(i, g)}
            onRemove={() => removeItem(i)}
            depth={depth + 1}
          />
        ) : (
          <RuleRow
            key={i}
            rule={item}
            onChange={(r) => updateItem(i, r)}
            onRemove={() => removeItem(i)}
          />
        )
      )}
      <div className="flex gap-2">
        <button
          className="text-xs text-violet-400 hover:text-violet-300 px-2 py-1 border border-violet-500/30 rounded"
          onClick={addRule}
        >
          + Add Rule
        </button>
        {depth < 2 && (
          <button
            className="text-xs text-slate-400 hover:text-slate-300 px-2 py-1 border border-slate-600/30 rounded"
            onClick={addGroup}
          >
            + Add Group
          </button>
        )}
      </div>
    </div>
  );
}

export function RuleBuilder({
  rules,
  onChange,
}: {
  rules: RuleGroup | null;
  onChange: (rules: RuleGroup) => void;
}) {
  const group = rules ?? { operator: 'AND' as const, rules: [] };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-slate-300">Gate Rules</h4>
      <GroupEditor group={group} onChange={onChange} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/gates/RuleBuilder.tsx
git commit -m "feat: RuleBuilder component for visual gate rule editing"
```

---

## Task 3: RuleTestPanel Component

**Files:**
- Create: `src/components/gates/RuleTestPanel.tsx`

- [ ] **Step 1: Create the RuleTestPanel component**

This component lets users enter a mock context JSON and test their rules using the `gate.test` tRPC endpoint. Shows live verdict.

```tsx
'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import { VerdictBadge } from './VerdictBadge';

type GateMode = 'auto' | 'rules' | 'hold' | 'manual' | 'skip';

type RuleGroup = {
  operator: 'AND' | 'OR';
  rules: unknown[];
};

type GateEvaluation = {
  verdict: 'proceed' | 'hold' | 'rework' | 'abort';
  passed: boolean;
  reason: string;
  ruleResults: Array<{
    field: string;
    operator: string;
    expected: unknown;
    actual: unknown;
    passed: boolean;
    severity: string;
    label?: string;
  }>;
};

export function RuleTestPanel({
  mode,
  rules,
}: {
  mode: GateMode;
  rules: RuleGroup | null;
}) {
  const [contextJson, setContextJson] = useState('{\n  "exit_code": 0,\n  "cost_usd": 0.05,\n  "files_changed": 3\n}');
  const [result, setResult] = useState<GateEvaluation | null>(null);
  const [error, setError] = useState<string | null>(null);

  const testMutation = trpc.gate.test.useMutation({
    onSuccess: (data: GateEvaluation) => {
      setResult(data);
      setError(null);
    },
    onError: (err: { message: string }) => {
      setError(err.message);
      setResult(null);
    },
  });

  const runTest = () => {
    try {
      const context = JSON.parse(contextJson);
      testMutation.mutate({ mode, rules, context });
    } catch {
      setError('Invalid JSON in context field');
    }
  };

  return (
    <div className="space-y-3 p-4 rounded-lg bg-slate-900/50 border border-slate-700/50">
      <h4 className="text-sm font-medium text-slate-300">Test Gate Rules</h4>
      <div>
        <label className="text-xs text-slate-500 block mb-1">Mock Context (JSON)</label>
        <textarea
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-300 font-mono h-24 resize-y"
          value={contextJson}
          onChange={(e) => setContextJson(e.target.value)}
        />
      </div>
      <button
        className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded transition-colors"
        onClick={runTest}
        disabled={testMutation.isPending}
      >
        {testMutation.isPending ? 'Evaluating...' : 'Test Rules'}
      </button>

      {error && (
        <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <VerdictBadge verdict={result.verdict} />
            <span className="text-sm text-slate-400">{result.reason}</span>
          </div>
          {result.ruleResults.length > 0 && (
            <div className="space-y-1">
              {result.ruleResults.map((r, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${
                    r.passed ? 'bg-green-500/5 text-green-400' : 'bg-red-500/5 text-red-400'
                  }`}
                >
                  <span>{r.passed ? '✓' : '✗'}</span>
                  <span className="font-mono">{r.field} {r.operator} {JSON.stringify(r.expected)}</span>
                  <span className="text-slate-500">→ actual: {JSON.stringify(r.actual)}</span>
                  {r.label && <span className="text-slate-600">({r.label})</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/gates/RuleTestPanel.tsx
git commit -m "feat: RuleTestPanel component for live gate rule testing"
```

---

## Task 4: Wire Gate UI into Settings Page

**Files:**
- Modify (EDIT ONLY): `src/app/.../settings/page.tsx`

This is the most complex task. The settings page currently has a stage table with a gate mode dropdown. We need to add:
1. A rule editor that appears when gate mode is "rules"
2. A test panel below the rule editor
3. Save rules to the stage via the existing pipeline stage update endpoint

- [ ] **Step 1: Read the current settings page**

Read `src/app/.../settings/page.tsx` fully to understand the current structure. Identify:
- Where the gate mode dropdown is
- How stages are created/updated
- What tRPC mutations are used

- [ ] **Step 2: Add imports for gate components**

Using Edit, add to the imports section:

```tsx
import { RuleBuilder } from '@/components/gates/RuleBuilder';
import { RuleTestPanel } from '@/components/gates/RuleTestPanel';
```

- [ ] **Step 3: Add rule editor below gate mode dropdown**

Find the gate mode dropdown in the stage form/edit section. Using Edit, add below it:

```tsx
{gateMode === 'rules' && (
  <div className="mt-4 space-y-4">
    <RuleBuilder
      rules={gateRules}
      onChange={(rules) => setGateRules(rules)}
    />
    <RuleTestPanel mode={gateMode} rules={gateRules} />
  </div>
)}
```

The exact insertion point depends on reading the file. The state variable `gateRules` needs to be added if it doesn't exist.

- [ ] **Step 4: Ensure gateRules state exists**

If the component doesn't already track gateRules, add state:

```tsx
const [gateRules, setGateRules] = useState<RuleGroup | null>(null);
```

And ensure it's included in the stage update mutation payload.

- [ ] **Step 5: Type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Fix any type errors using Edit. If a type is missing, create it or import from the gates types.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: wire gate rule builder and test panel into settings page"
```

---

## Task 5: Display Gate Verdicts on Pipeline Detail

**Files:**
- Modify (EDIT ONLY): `src/app/.../pipelines/[id]/page.tsx`

- [ ] **Step 1: Read the pipeline detail page**

Read the file to understand how stages are displayed and whether gate results are already queried.

- [ ] **Step 2: Add VerdictBadge import**

```tsx
import { VerdictBadge } from '@/components/gates/VerdictBadge';
```

- [ ] **Step 3: Display verdict on stage cards**

Find where stage cards are rendered. If the stage data includes gate results (from the stageGateResult relation), display the verdict:

```tsx
{stage.gateResults?.[0] && (
  <VerdictBadge verdict={stage.gateResults[0].verdict} />
)}
```

If gate results aren't in the query, add them to the tRPC query's include/select.

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: display gate verdicts on pipeline detail stage cards"
```

---

## Task 6: Verification

- [ ] **Step 1: Run all integration tests**

```bash
npx vitest run src/__tests__/integration/ 2>&1 | tail -20
```

Expected: All tests pass (62+ including the 38 gate tests).

- [ ] **Step 2: Run phase snapshot check**

```bash
bash .claude/hooks/phase-snapshot-check.sh
```

Expected: No regressions (only new files added, existing files edited with additions).

- [ ] **Step 3: Run invariant verification**

```bash
grep -rn '"research"\|"implement"\|"review"\|"deploy"\|"complete"\|"rework"' src/ \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=__tests__ --exclude-dir=adapters \
  | grep -v 'seed\|fixture\|\.test\.' || echo "PASS: No hardcoded stage names"
```

- [ ] **Step 4: Signal ready for review**

Tell the user: "Phase R4-V implementation complete. Ready for `/review` (Codex adversarial review)."

---

## Exit Criteria

User verification in browser:
1. Open Settings → Stages → select a stage with gate mode "rules"
2. See the rule builder with existing seeded rules (cost_usd < 10, exit_code == 0)
3. Add a new rule, change operators/values
4. Click "Test Rules" with mock context JSON
5. See live verdict (proceed/hold/rework/abort) with per-rule pass/fail
6. Open Pipelines → pipeline detail → see gate verdicts on stage cards (if any runs exist)
