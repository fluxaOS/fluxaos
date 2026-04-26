'use client';

import { useCallback } from 'react';
import type {
  FailureAction,
  Rule,
  RuleGroup,
  RuleOperator,
  RuleSeverity,
} from '@/core/gates/types';
import { isRuleGroup } from '@/core/gates/types';

// ─── Constants ──────────────────────────────────────────────────────────────

const OPERATORS: { value: RuleOperator; label: string }[] = [
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'not equals' },
  { value: 'less_than', label: 'less than' },
  { value: 'greater_than', label: 'greater than' },
  { value: 'contains', label: 'contains' },
  { value: 'matches', label: 'matches' },
  { value: 'in', label: 'in' },
  { value: 'exists', label: 'exists' },
];

const SEVERITIES: { value: RuleSeverity; label: string }[] = [
  { value: 'required', label: 'required' },
  { value: 'warn', label: 'warn' },
  { value: 'block', label: 'block' },
];

const ACTIONS: { value: FailureAction; label: string }[] = [
  { value: 'proceed', label: 'proceed' },
  { value: 'hold', label: 'hold' },
  { value: 'rework', label: 'rework' },
  { value: 'abort', label: 'abort' },
  { value: 'notify', label: 'notify' },
  { value: 'escalate', label: 'escalate' },
];

const MAX_DEPTH = 3;

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRule(): Rule {
  return {
    field: '',
    operator: 'equals',
    value: '',
    severity: 'required',
    onFail: 'hold',
    label: '',
  };
}

function makeGroup(): RuleGroup {
  return { logic: 'AND', rules: [makeRule()] };
}

/** Auto-convert numeric strings to numbers for the engine. */
function coerceValue(raw: string): unknown {
  if (raw === '') return '';
  const num = Number(raw);
  if (!Number.isNaN(num) && raw.trim() !== '') return num;
  return raw;
}

// ─── Shared input classes ───────────────────────────────────────────────────

const inputCls =
  'bg-slate-900 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:border-soft-violet/60 transition-colors';

const selectCls =
  'bg-slate-900 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none focus:border-soft-violet/60 transition-colors';

const btnDanger =
  'px-1.5 py-0.5 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded transition-colors';

const btnAdd =
  'text-xs text-soft-violet hover:text-soft-violet-hover transition-colors';

// ─── Rule Row ───────────────────────────────────────────────────────────────

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
    <div className="flex flex-wrap items-center gap-2 py-1.5">
      <input
        type="text"
        placeholder="field"
        value={rule.field}
        onChange={(e) => onChange({ ...rule, field: e.target.value })}
        className={`${inputCls} w-28`}
      />
      <select
        value={rule.operator}
        onChange={(e) =>
          onChange({ ...rule, operator: e.target.value as RuleOperator })
        }
        className={selectCls}
      >
        {OPERATORS.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>
      {rule.operator !== 'exists' && (
        <input
          type="text"
          placeholder="value"
          value={String(rule.value ?? '')}
          onChange={(e) =>
            onChange({ ...rule, value: coerceValue(e.target.value) })
          }
          className={`${inputCls} w-24`}
        />
      )}
      <select
        value={rule.severity}
        onChange={(e) =>
          onChange({ ...rule, severity: e.target.value as RuleSeverity })
        }
        className={selectCls}
      >
        {SEVERITIES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <select
        value={rule.onFail}
        onChange={(e) =>
          onChange({ ...rule, onFail: e.target.value as FailureAction })
        }
        className={selectCls}
      >
        {ACTIONS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
      <input
        type="text"
        placeholder="label (optional)"
        value={rule.label ?? ''}
        onChange={(e) =>
          onChange({ ...rule, label: e.target.value || undefined })
        }
        className={`${inputCls} w-32`}
      />
      <button type="button" onClick={onRemove} className={btnDanger}>
        Remove
      </button>
    </div>
  );
}

// ─── Group Editor ───────────────────────────────────────────────────────────

function GroupEditor({
  group,
  onChange,
  onRemove,
  depth,
}: {
  group: RuleGroup;
  onChange: (g: RuleGroup) => void;
  onRemove: (() => void) | null;
  depth: number;
}) {
  const updateItem = useCallback(
    (idx: number, item: Rule | RuleGroup) => {
      const next = [...group.rules];
      next[idx] = item;
      onChange({ ...group, rules: next });
    },
    [group, onChange]
  );

  const removeItem = useCallback(
    (idx: number) => {
      const next = group.rules.filter((_, i) => i !== idx);
      onChange({ ...group, rules: next });
    },
    [group, onChange]
  );

  const addRule = useCallback(() => {
    onChange({ ...group, rules: [...group.rules, makeRule()] });
  }, [group, onChange]);

  const addGroup = useCallback(() => {
    if (depth >= MAX_DEPTH) return;
    onChange({ ...group, rules: [...group.rules, makeGroup()] });
  }, [group, onChange, depth]);

  const toggleLogic = useCallback(() => {
    onChange({ ...group, logic: group.logic === 'AND' ? 'OR' : 'AND' });
  }, [group, onChange]);

  return (
    <div
      className={`border border-slate-700/30 rounded-xl p-3 ${
        depth > 0 ? 'ml-4 bg-slate-800/30' : 'bg-slate-800/20'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={toggleLogic}
          className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-700/40 text-slate-300 hover:bg-slate-700/60 transition-colors"
        >
          {group.logic}
        </button>
        <span className="text-[10px] text-slate-500">(click to toggle)</span>
        {onRemove && (
          <button type="button" onClick={onRemove} className={btnDanger}>
            Remove group
          </button>
        )}
      </div>

      <div className="space-y-1">
        {group.rules.map((item, idx) =>
          isRuleGroup(item) ? (
            <GroupEditor
              key={idx}
              group={item}
              onChange={(g) => updateItem(idx, g)}
              onRemove={() => removeItem(idx)}
              depth={depth + 1}
            />
          ) : (
            <RuleRow
              key={idx}
              rule={item}
              onChange={(r) => updateItem(idx, r)}
              onRemove={() => removeItem(idx)}
            />
          )
        )}
      </div>

      <div className="flex gap-3 mt-2">
        <button type="button" onClick={addRule} className={btnAdd}>
          + Add rule
        </button>
        {depth < MAX_DEPTH && (
          <button type="button" onClick={addGroup} className={btnAdd}>
            + Add group
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Export ──────────────────────────────────────────────────────────────────

export function RuleBuilder({
  rules,
  onChange,
}: {
  rules: RuleGroup | null;
  onChange: (rules: RuleGroup) => void;
}) {
  const group = rules ?? makeGroup();

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-slate-400">Gate Rules</h4>
      <GroupEditor
        group={group}
        onChange={onChange}
        onRemove={null}
        depth={0}
      />
    </div>
  );
}
