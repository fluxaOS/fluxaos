'use client';

import { useEffect, useState } from 'react';
import { CatalogBadge } from '@/components/catalog-badge';

const MAX_LABEL_LENGTH = 64;

function normalizeLabels(existing: string[], raw: string): string[] {
  const seen = new Set(existing.map((label) => label.toLowerCase()));
  const next = [...existing];
  for (const token of raw.split(/[,\s]+/)) {
    const label = token.trim().slice(0, MAX_LABEL_LENGTH);
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    next.push(label);
  }
  return next;
}

// ─── Editable text field (save on blur / Enter) ─────────────────────────────

export function EditableTitle({
  value,
  onSave,
  disabled,
}: {
  value: string;
  onSave: (val: string) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      setDraft(value);
    }
    setEditing(false);
  }

  if (!editing) {
    return (
      <h2
        className="text-xl font-bold text-white cursor-pointer hover:text-slate-300 transition-colors"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        title="Click to Edit"
      >
        {value}
      </h2>
    );
  }

  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      disabled={disabled}
      className="text-xl font-bold text-white bg-slate-900 border border-slate-700/60 rounded-lg px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-electric-violet/30"
    />
  );
}

// ─── Editable body (markdown) ───────────────────────────────────────────────

export function EditableBody({
  bodyMd,
  bodyHtml,
  onSave,
  disabled,
}: {
  bodyMd: string | null;
  bodyHtml: string | null;
  onSave: (val: string) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bodyMd ?? '');

  function commit() {
    if (draft !== (bodyMd ?? '')) {
      onSave(draft);
    }
    setEditing(false);
  }

  if (!editing) {
    // bodyHtml is rendered at write time by the server (invariant #14),
    // not from untrusted user input — safe to render.
    return (
      <div
        className="text-sm text-slate-400 cursor-pointer hover:bg-white/[0.02] rounded-lg p-2 -m-2 transition-colors min-h-[40px]"
        onClick={() => {
          setDraft(bodyMd ?? '');
          setEditing(true);
        }}
        title="Click to Edit"
      >
        {bodyHtml ? (
          <div
            className="markdown-body"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: bodyHtml is server-sanitized per invariant #14
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        ) : (
          <span className="text-slate-600 italic">
            No description. Click to add one.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={6}
        disabled={disabled}
        className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-violet/30 resize-y"
        placeholder="Describe the issue (Markdown)..."
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={commit}
          disabled={disabled}
          className="px-3 py-1.5 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-all"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(bodyMd ?? '');
            setEditing(false);
          }}
          className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 text-xs rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Editable labels (commit on comma / space / Enter / paste) ──────────────

export function EditableLabels({
  value,
  onSave,
  disabled,
}: {
  value: string[];
  onSave: (labels: string[]) => void;
  disabled: boolean;
}) {
  const [labels, setLabels] = useState(value);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setLabels(value);
  }, [value]);

  function commitRaw(raw: string) {
    const next = normalizeLabels(labels, raw);
    setLabels(next);
    setDraft('');
    if (JSON.stringify(next) !== JSON.stringify(labels)) onSave(next);
  }

  function removeLabel(label: string) {
    const next = labels.filter((item) => item !== label);
    setLabels(next);
    onSave(next);
  }

  return (
    <fieldset
      className="flex items-center gap-2 min-w-[220px]"
      aria-label="Labels"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 w-16 shrink-0">
        Labels
      </span>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-700/30 px-2 py-1 min-h-8">
        {labels.map((label) => (
          <span
            key={label}
            className="inline-flex items-center gap-1 rounded-full bg-electric-violet/15 px-2 py-0.5 text-[11px] font-medium text-soft-violet"
          >
            {label}
            <button
              type="button"
              aria-label={`Remove ${label}`}
              onClick={() => removeLabel(label)}
              disabled={disabled}
              className="text-soft-violet/70 hover:text-soft-violet disabled:opacity-50"
            >
              x
            </button>
          </span>
        ))}
        <input
          type="text"
          aria-label="Labels"
          value={draft}
          onChange={(e) => {
            const raw = e.target.value;
            if (/[,\s]/.test(raw)) {
              commitRaw(raw);
              return;
            }
            setDraft(raw.slice(0, MAX_LABEL_LENGTH));
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ',' && e.key !== ' ') return;
            e.preventDefault();
            commitRaw(draft);
          }}
          onPaste={(e) => {
            e.preventDefault();
            commitRaw(e.clipboardData.getData('text'));
          }}
          disabled={disabled}
          placeholder={labels.length === 0 ? 'Add labels' : ''}
          className="min-w-24 flex-1 bg-transparent text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none disabled:opacity-50"
        />
      </div>
    </fieldset>
  );
}

// ─── Catalog dropdown selector ──────────────────────────────────────────────

export function CatalogSelect({
  label,
  items,
  currentId,
  onSelect,
  disabled,
}: {
  label: string;
  items: Array<{ id: string; displayName: string; color: string }>;
  currentId: string;
  onSelect: (id: string) => void;
  disabled: boolean;
}) {
  const current = items.find((i) => i.id === currentId);

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600 w-16 shrink-0">
        {label}
      </span>
      {current && (
        <CatalogBadge displayName={current.displayName} color={current.color} />
      )}
      <select
        value={currentId}
        onChange={(e) => {
          if (e.target.value !== currentId) onSelect(e.target.value);
        }}
        disabled={disabled}
        className="bg-transparent border-0 text-xs text-slate-500 focus:outline-none cursor-pointer ml-1"
      >
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.displayName}
          </option>
        ))}
      </select>
    </div>
  );
}
