'use client';

import { useState } from 'react';
import { CatalogBadge } from '@/components/catalog-badge';

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
        onClick={() => { setDraft(value); setEditing(true); }}
        title="Click to edit"
      >
        {value}
      </h2>
    );
  }

  return (
    <input
      autoFocus
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
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
        onClick={() => { setDraft(bodyMd ?? ''); setEditing(true); }}
        title="Click to edit"
      >
        {bodyHtml ? (
          <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        ) : (
          <span className="text-slate-600 italic">No description. Click to add one.</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        autoFocus
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
          onClick={() => { setDraft(bodyMd ?? ''); setEditing(false); }}
          className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 text-xs rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
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
      {current && <CatalogBadge displayName={current.displayName} color={current.color} />}
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
