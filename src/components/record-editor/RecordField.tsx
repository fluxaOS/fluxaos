// src/components/record-editor/RecordField.tsx
'use client';

import type { FieldDescriptor } from './types';

type Props = {
  field: FieldDescriptor<Record<string, unknown>>;
  value: unknown;
  editing: boolean;
  onChange: (next: unknown) => void;
  error?: string | null;
};

export function RecordField({ field, value, editing, onChange, error }: Props) {
  const common =
    'w-full bg-slate-900 border rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-violet/40';
  const borderClass = error ? 'border-red-500/60' : 'border-slate-700/60';

  const label = (
    <label className="text-xs font-medium text-slate-400 block mb-1">
      {field.label}
      {field.required ? <span className="text-red-400 ml-0.5">*</span> : null}
    </label>
  );

  // READ-ONLY (always displayed, never editable — used for `version`, timestamps)
  if (field.fieldType === 'readonly') {
    return (
      <div className="mb-3">
        {label}
        <div className="text-sm font-mono text-slate-300 px-3 py-2 bg-slate-900/60 rounded-lg">
          {String(value ?? '—')}
        </div>
      </div>
    );
  }

  // BOOLEAN toggle
  if (field.fieldType === 'boolean') {
    return (
      <div className="mb-3">
        {label}
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            disabled={!editing}
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="w-10 h-5 appearance-none bg-slate-700 rounded-full relative cursor-pointer transition-colors checked:bg-electric-violet disabled:opacity-50"
          />
          <span className="ml-2 text-sm text-slate-300">
            {value ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      </div>
    );
  }

  // TAGS (comma-separated chip input)
  if (field.fieldType === 'tags') {
    const arr: string[] = Array.isArray(value) ? (value as string[]) : [];
    const raw = arr.join(', ');
    return (
      <div className="mb-3">
        {label}
        {editing ? (
          <input
            type="text"
            value={raw}
            onChange={(e) => {
              const parsed = e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean);
              onChange(parsed);
            }}
            placeholder="comma, separated, tags"
            aria-label={field.label}
            className={`${common} ${borderClass}`}
          />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {arr.length === 0 ? (
              <span className="text-sm text-slate-500">—</span>
            ) : (
              // Key includes index because the input doesn't dedupe — a
              // user could type "react, react" and `key={tag}` alone would
              // collide and produce React console warnings.
              arr.map((tag, i) => (
                <span
                  key={`${tag}-${i}`}
                  className="px-2 py-0.5 text-xs bg-electric-violet/15 text-soft-violet rounded-full"
                >
                  {tag}
                </span>
              ))
            )}
          </div>
        )}
        {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
      </div>
    );
  }

  // TEXTAREA-LARGE
  if (field.fieldType === 'textarea-large') {
    return (
      <div className="mb-3">
        {label}
        <textarea
          disabled={!editing}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          aria-label={field.label}
          rows={14}
          className={`${common} ${borderClass} font-mono text-xs leading-relaxed disabled:opacity-75`}
        />
        {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
      </div>
    );
  }

  // TEXTAREA
  if (field.fieldType === 'textarea') {
    return (
      <div className="mb-3">
        {label}
        <textarea
          disabled={!editing}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          aria-label={field.label}
          rows={4}
          className={`${common} ${borderClass} disabled:opacity-75`}
        />
        {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
      </div>
    );
  }

  // TEXT (default)
  return (
    <div className="mb-3">
      {label}
      <input
        type="text"
        disabled={!editing}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        aria-label={field.label}
        className={`${common} ${borderClass} disabled:opacity-75`}
      />
      {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
