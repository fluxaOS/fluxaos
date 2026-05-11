// src/components/record-editor/RecordField.tsx
'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { FieldDescriptor } from './types';

type Props = {
  field: FieldDescriptor<Record<string, unknown>>;
  value: unknown;
  editing: boolean;
  onChange: (next: unknown) => void;
  error?: string | null;
  /**
   * Reports field-local validity errors (e.g. JSON parse failures) up to
   * the editor so Save can block. Called with `null` when the field is
   * back in a valid state.
   */
  onValidityChange?: (key: string, error: string | null) => void;
};

export function RecordField(props: Props) {
  const { field, editing } = props;
  // Sensitive fields blur their viewing-state value behind a Preview
  // overlay until the operator opts in. Edit mode bypasses the gate.
  // (FLX-11)
  const [revealed, setRevealed] = useState(false);
  // Reset reveal state when editing flips on/off so a stale reveal
  // doesn't carry between view sessions or different selected records.
  const [prevEditingForGate, setPrevEditingForGate] = useState(editing);
  if (prevEditingForGate !== editing) {
    setPrevEditingForGate(editing);
    setRevealed(false);
  }
  const sensitive = Boolean(field.sensitive);
  const gateActive = sensitive && !editing && !revealed;

  if (gateActive) {
    return (
      <SensitiveGate
        label={field.label}
        onReveal={() => setRevealed(true)}
        sampleValue={props.value}
      />
    );
  }

  return <RecordFieldInner {...props} />;
}

function RecordFieldInner({
  field,
  value,
  editing,
  onChange,
  error,
  onValidityChange,
}: Props) {
  const common =
    'w-full bg-slate-900 border rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-violet/40';
  const borderClass = error ? 'border-red-500/60' : 'border-slate-700/60';

  const label = (
    <label className="text-xs font-medium text-slate-400 block mb-1">
      {field.label}
      {field.required ? <span className="text-red-400 ml-0.5">*</span> : null}
    </label>
  );

  // Optional sub-label rendered under the input. Only emitted when the
  // descriptor sets `helpText` — no empty span, no fallback string (per
  // "no fallbacks ever"). Wrapped in a fragment-less ternary so callers
  // can `{helpTextNode}` next to the input without conditional wrappers.
  const helpTextNode = field.helpText ? (
    <p
      className="mt-1 text-[11px] text-slate-500"
      data-testid={`help-${field.key}`}
    >
      {field.helpText}
    </p>
  ) : null;

  // READ-ONLY (always displayed, never editable — used for `version`, timestamps)
  if (field.fieldType === 'readonly') {
    return (
      <div className="mb-3">
        {label}
        <div className="text-sm font-mono text-slate-300 px-3 py-2 bg-slate-900/60 rounded-lg">
          {String(value ?? '—')}
        </div>
        {helpTextNode}
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
        {helpTextNode}
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
        {helpTextNode}
      </div>
    );
  }

  // JSONB (structured JSON edit/view)
  if (field.fieldType === 'jsonb') {
    return (
      <JsonField
        field={field}
        value={value}
        editing={editing}
        onChange={onChange}
        error={error}
        onValidityChange={onValidityChange}
        common={common}
        borderClass={borderClass}
        label={label}
        helpTextNode={helpTextNode}
      />
    );
  }

  // SELECT (dropdown of allowed string values; FLX-12)
  if (field.fieldType === 'select') {
    const options = field.options ?? [];
    return (
      <div className="mb-3">
        {label}
        <select
          disabled={!editing}
          value={String(value ?? options[0] ?? '')}
          onChange={(e) => onChange(e.target.value)}
          aria-label={field.label}
          className={`${common} ${borderClass} disabled:opacity-75`}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        {error ? <p className="mt-1 text-xs text-red-400">{error}</p> : null}
        {helpTextNode}
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
        {helpTextNode}
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
        {helpTextNode}
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
      {helpTextNode}
    </div>
  );
}

function SensitiveGate({
  label,
  onReveal,
  sampleValue,
}: {
  label: string;
  onReveal: () => void;
  sampleValue: unknown;
}) {
  // Show a faint blurred preview so the operator can tell *something* is
  // there (and the field isn't simply empty) without the content being
  // legible from a screen-share or screenshot.
  const blurredText = sampleValueToBlurredString(sampleValue);

  return (
    <div className="mb-3" data-testid={`sensitive-gate-${label}`}>
      <label className="text-xs font-medium text-slate-400 block mb-1">
        {label}
      </label>
      <div className="relative rounded-lg border border-slate-700/60 bg-slate-900 px-3 py-3 min-h-[64px] overflow-hidden">
        <div
          aria-hidden="true"
          className="text-xs text-slate-500 font-mono whitespace-pre-wrap break-all blur-md select-none pointer-events-none"
        >
          {blurredText || '— hidden —'}
        </div>
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40">
          <button
            type="button"
            onClick={onReveal}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-electric-violet/90 text-white hover:bg-electric-violet transition-colors"
          >
            Preview
          </button>
        </div>
      </div>
      <p className="mt-1 text-[10px] text-slate-500">
        Sensitive content. Click Preview to reveal, or Edit to modify.
      </p>
    </div>
  );
}

function sampleValueToBlurredString(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v.slice(0, 200);
  try {
    return JSON.stringify(v).slice(0, 200);
  } catch {
    return String(v).slice(0, 200);
  }
}

type JsonFieldProps = {
  field: FieldDescriptor<Record<string, unknown>>;
  value: unknown;
  editing: boolean;
  onChange: (next: unknown) => void;
  error?: string | null;
  onValidityChange?: (key: string, error: string | null) => void;
  common: string;
  borderClass: string;
  label: React.ReactNode;
  helpTextNode: React.ReactNode | null;
};

function formatJson(v: unknown): string {
  if (v === undefined || v === null) return '';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function JsonField({
  field,
  value,
  editing,
  onChange,
  error,
  onValidityChange,
  common,
  borderClass,
  label,
  helpTextNode,
}: JsonFieldProps) {
  const fieldKey = field.key;
  // Track raw textarea content separately from the parsed value. Parents
  // only see successfully-parsed objects; invalid edits stay local until
  // the user fixes them, while validity is reported up so Save can block.
  const [raw, setRaw] = useState<string>(() => formatJson(value));
  const [parseError, setParseError] = useState<string | null>(null);
  // Resync raw text from `value` whenever we transition between view and
  // edit modes — derived during render via `useState`'s "store previous
  // input" pattern so we never fire a setState inside an effect.
  const [prevEditing, setPrevEditing] = useState(editing);
  if (prevEditing !== editing) {
    setPrevEditing(editing);
    setRaw(formatJson(value));
    setParseError(null);
  }
  const lastReportedRef = useRef<string | null>(null);
  const errId = useId();

  // Report validity changes only when the message actually flips. Without
  // this guard the parent's setState fires every keystroke even when the
  // value is unchanged, churning React.
  useEffect(() => {
    const next = editing ? parseError : null;
    if (lastReportedRef.current !== next) {
      lastReportedRef.current = next;
      onValidityChange?.(fieldKey, next);
    }
  }, [editing, parseError, fieldKey, onValidityChange]);

  if (!editing) {
    const display = formatJson(value) || '—';
    return (
      <div className="mb-3">
        {label}
        <pre className="text-xs font-mono text-slate-300 px-3 py-2 bg-slate-900/60 rounded-lg whitespace-pre-wrap break-all max-h-64 overflow-auto">
          {display}
        </pre>
        {helpTextNode}
      </div>
    );
  }

  const handleChange = (next: string) => {
    setRaw(next);
    if (next.trim() === '') {
      setParseError(null);
      onChange(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(next);
      setParseError(null);
      onChange(parsed);
    } catch {
      setParseError(
        'Invalid JSON — must be a valid JSON value (e.g. { "key": "value" }). Leave blank to clear.'
      );
    }
  };

  const showError = parseError ?? error ?? null;

  return (
    <div className="mb-3">
      {label}
      <textarea
        value={raw}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={field.placeholder ?? '{ }'}
        aria-label={field.label}
        aria-invalid={Boolean(showError)}
        aria-describedby={showError ? errId : undefined}
        rows={8}
        spellCheck={false}
        className={`${common} ${borderClass} font-mono text-xs leading-relaxed`}
      />
      {showError ? (
        <p id={errId} className="mt-1 text-xs text-red-400">
          {showError}
        </p>
      ) : null}
      {helpTextNode}
    </div>
  );
}
