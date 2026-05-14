// src/components/record-editor/CreateEntityForm.tsx
//
// Generic inline create form used by settings pages.
// Renders a Card with a title, a configurable list of fields, an optional
// error banner, and a submit/cancel button row.  The caller owns the
// mutation; this component only manages local field state and hands values
// back via `onSubmit`.

'use client';

import { useState } from 'react';
import { Card } from '@/components/card';

/** Minimal field descriptor used by the create form (independent of the full
 *  RecordEditor FieldDescriptor so pages don't need to thread T generics). */
export type CreateFormField = {
  /** Key used in the submitted values map */
  key: string;
  /** Label shown above the input */
  label: string;
  /** Input type — defaults to 'text' */
  type?: 'text' | 'textarea' | 'select';
  /** When true the submit button is disabled while this field is empty */
  required?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Number of visible rows for textarea (defaults to 3) */
  rows?: number;
  /** For type='select' — list of { value, label } options */
  options?: { value: string; label: string }[];
  /** Default value; for select this must be one of the option values */
  defaultValue?: string;
  /** When true the field uses a monospace font (e.g. JSON, cron expressions) */
  mono?: boolean;
};

export type CreateEntityFormProps = {
  /** Heading shown at the top of the card ("New Skill", "New Team", etc.) */
  title: string;
  /** Field configurations driving the rendered inputs */
  fields: CreateFormField[];
  /**
   * Called when the operator clicks Create.  Receives a map of key → string
   * value for every field.  Throw to surface an error banner.
   */
  onSubmit: (values: Record<string, string>) => Promise<void>;
  /** Called when the operator clicks Cancel */
  onCancel: () => void;
  /** Override the submit button label (defaults to "Create") */
  submitLabel?: string;
};

function buildInitial(fields: CreateFormField[]): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.key, f.defaultValue ?? '']));
}

export function CreateEntityForm({
  title,
  fields,
  onSubmit,
  onCancel,
  submitLabel = 'Create',
}: CreateEntityFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    buildInitial(fields)
  );
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSubmitDisabled =
    isPending ||
    fields.some((f) => f.required && !(values[f.key] ?? '').trim());

  const handleSubmit = async () => {
    setError(null);
    setIsPending(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsPending(false);
    }
  };

  const set = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  return (
    <Card padding="p-6">
      <h3 className="text-sm font-semibold text-white mb-3">{title}</h3>

      {error ? (
        <div className="mb-3 px-3 py-2 rounded-lg text-sm bg-red-600/10 text-red-300 border border-red-600/30">
          {error}
        </div>
      ) : null}

      <div className="space-y-3">
        {fields.map((f) => {
          const value = values[f.key] ?? '';
          const inputClass = `w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white${f.mono ? ' font-mono' : ''}`;
          const type = f.type ?? 'text';

          return (
            <div key={f.key}>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                {f.label}
                {f.required ? (
                  <span className="text-red-400 ml-1">*</span>
                ) : null}
              </label>

              {type === 'textarea' ? (
                <textarea
                  aria-label={f.label}
                  rows={f.rows ?? 3}
                  placeholder={f.placeholder}
                  className={`${inputClass} resize-none`}
                  value={value}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              ) : type === 'select' ? (
                <select
                  aria-label={f.label}
                  className={inputClass}
                  value={value}
                  onChange={(e) => set(f.key, e.target.value)}
                >
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  aria-label={f.label}
                  placeholder={f.placeholder}
                  className={inputClass}
                  value={value}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
            </div>
          );
        })}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all disabled:opacity-50"
            disabled={isSubmitDisabled}
            onClick={handleSubmit}
          >
            {isPending ? `${submitLabel}…` : submitLabel}
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-slate-300 transition-all"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </Card>
  );
}
