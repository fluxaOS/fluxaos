// src/components/record-editor/RepoUrlField.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc/client';
import type { CustomRendererProps } from './types';

type Validity =
  | { kind: 'idle' }
  | { kind: 'validating' }
  | { kind: 'ok'; provider: string; owner: string; repo: string }
  | { kind: 'error'; reason: string; detail?: string };

const REASON_COPY: Record<string, string> = {
  INVALID_URL:
    'Not a valid URL. Expected https://github.com/owner/repo or similar.',
  UNSUPPORTED_HOST:
    'No git provider configured for this host. Supported: github.com.',
  REPO_NOT_FOUND:
    'Repository not found. Check the URL, or confirm the integration has access.',
  AUTH_FAILED:
    'Could not authenticate with the provider. Check the provider credential.',
  NETWORK: 'Could not reach the provider. Try again.',
};

function reasonCopy(reason: string): string {
  // Lookup is a hard map by design; an unrecognized reason is surfaced
  // verbatim (not silently swapped for a default) per "no fallbacks".
  const known = Object.hasOwn(REASON_COPY, reason);
  return known ? REASON_COPY[reason] : reason;
}

/**
 * FLX-227: two-step Validate / Save UX for the repoUrl field. The
 * renderer wires its validity state to RecordEditor via
 * `onValidityChange` so the Save button can block when validation is
 * required but missing.
 *
 * Validation rules surfaced to the user:
 *   - Validate is disabled until URL has a valid shape (zod .url()-ish).
 *   - Save is enabled when:
 *       (a) validation succeeded for current value, OR
 *       (b) value is unchanged from the persisted value (no edit), OR
 *       (c) value is blank (repoUrl is optional).
 *   - Editing after a green check clears the result and re-disables Save.
 */
export function RepoUrlField<TRecord>(props: CustomRendererProps<TRecord>) {
  const { field, value, editing, onChange, onValidityChange } = props;
  const current = value == null ? '' : String(value);
  const [persistedValue, setPersistedValue] = useState(current);
  const [wasEditing, setWasEditing] = useState(editing);
  if (wasEditing !== editing) {
    setWasEditing(editing);
    setPersistedValue(current);
  }

  const isBlank = current.trim() === '';
  const isUnchanged = current === persistedValue;

  const [validation, setValidation] = useState<{
    url: string;
    validity: Validity;
  }>({ url: current, validity: { kind: 'idle' } });
  const validity = useMemo<Validity>(
    () => (validation.url === current ? validation.validity : { kind: 'idle' }),
    [validation, current]
  );
  const validateMutation = trpc.project.validateRepoUrl.useMutation();

  // Report validity upward. Save is blocked when validity is 'error'
  // OR (the field has a non-blank, changed URL that hasn't been
  // validated). Blank URL is permitted (repoUrl is nullable).
  useEffect(() => {
    if (!editing) {
      onValidityChange?.(field.key, null);
      return;
    }
    if (isBlank || isUnchanged) {
      onValidityChange?.(field.key, null);
      return;
    }
    if (validity.kind === 'ok') {
      onValidityChange?.(field.key, null);
      return;
    }
    if (validity.kind === 'error') {
      onValidityChange?.(field.key, reasonCopy(validity.reason));
      return;
    }
    onValidityChange?.(field.key, 'Validate the URL before saving.');
  }, [editing, isBlank, isUnchanged, validity, field.key, onValidityChange]);

  // Shape check for enabling the Validate button. Equivalent to zod's
  // .url(): must be a parseable URL with http(s) scheme.
  const hasValidShape = (() => {
    if (isBlank) return false;
    try {
      const u = new URL(current);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  })();

  const handleValidate = async () => {
    setValidation({ url: current, validity: { kind: 'validating' } });
    try {
      const result = await validateMutation.mutateAsync({ url: current });
      if (result.ok) {
        setValidation({
          url: current,
          validity: {
            kind: 'ok',
            provider: result.provider,
            owner: result.coords.owner,
            repo: result.coords.repo,
          },
        });
      } else {
        setValidation({
          url: current,
          validity: {
            kind: 'error',
            reason: result.reason,
            detail: result.detail,
          },
        });
      }
    } catch (err) {
      setValidation({
        url: current,
        validity: {
          kind: 'error',
          reason: 'NETWORK',
          detail: err instanceof Error ? err.message : String(err),
        },
      });
    }
  };

  const inputClass =
    'flex-1 bg-slate-900 border rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-violet/40';

  const helpTextNode = field.helpText ? (
    <p
      className="mt-1 text-[11px] text-slate-500"
      data-testid={`help-${field.key}`}
    >
      {field.helpText}
    </p>
  ) : null;

  return (
    <div className="mb-3">
      <label className="text-xs font-medium text-slate-400 block mb-1">
        {field.label}
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          disabled={!editing}
          value={current}
          onChange={(e) =>
            onChange(e.target.value === '' ? null : e.target.value)
          }
          placeholder={field.placeholder}
          aria-label={field.label}
          className={`${inputClass} border-slate-700/60 disabled:opacity-75`}
          data-testid={`repo-url-input-${field.key}`}
        />
        <button
          type="button"
          disabled={
            !editing || !hasValidShape || validity.kind === 'validating'
          }
          onClick={handleValidate}
          className="px-3 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
          data-testid="repo-url-validate"
        >
          {validity.kind === 'validating' ? 'Validating…' : 'Validate'}
        </button>
      </div>
      {validity.kind === 'ok' ? (
        <p
          className="mt-1 text-xs text-emerald-400"
          data-testid="repo-url-validity-ok"
        >
          ✓ Verified · {validity.provider} · {validity.owner}/{validity.repo}
        </p>
      ) : null}
      {validity.kind === 'error' ? (
        <p
          className="mt-1 text-xs text-red-400"
          data-testid="repo-url-validity-error"
        >
          ✗ {reasonCopy(validity.reason)}
        </p>
      ) : null}
      {helpTextNode}
    </div>
  );
}
