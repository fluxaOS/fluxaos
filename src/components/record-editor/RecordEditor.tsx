// src/components/record-editor/RecordEditor.tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/card';
import { openConfirmModal } from '@/components/confirm-modal';
import { EmptyState } from '@/components/empty-state';
import { SkeletonTable } from '@/components/skeleton';
import { type ActionsState, RecordActionsBar } from './RecordActionsBar';
import { RecordField } from './RecordField';
import type {
  FieldDescriptor,
  RecordEditorProps,
  RecordWithVersion,
} from './types';

export function RecordEditor<TRecord extends RecordWithVersion>(
  props: RecordEditorProps<TRecord>
) {
  const {
    descriptor,
    records,
    isLoading,
    onSave,
    onDelete,
    onToggleEnabled,
    previewGate,
    canEdit = () => true,
    canDelete = () => true,
    onEditSnapshot,
  } = props;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [state, setState] = useState<ActionsState>({ kind: 'viewing' });
  const [draft, setDraft] = useState<Partial<TRecord>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Errors raised by the field renderer itself (e.g. JSON parse). Kept
  // separate from `fieldErrors` so descriptor-level validation can't
  // accidentally clear them.
  const [fieldValidity, setFieldValidity] = useState<Record<string, string>>(
    {}
  );

  const handleValidityChange = useCallback(
    (key: string, error: string | null) => {
      setFieldValidity((prev) => {
        if (error == null) {
          if (!(key in prev)) return prev;
          const { [key]: _omit, ...rest } = prev;
          void _omit;
          return rest;
        }
        if (prev[key] === error) return prev;
        return { ...prev, [key]: error };
      });
    },
    []
  );
  const [banner, setBanner] = useState<{
    kind: 'error' | 'info';
    text: string;
    conflict?: boolean;
  } | null>(null);

  const selected = useMemo(
    () => records.find((r) => r.id === selectedId) ?? null,
    [records, selectedId]
  );

  // Fire selection change to the parent so it can render auxiliary panels
  // (history, related records, etc.) without forking selection state.
  const onSelectionChange = props.onSelectionChange;
  useEffect(() => {
    onSelectionChange?.(selected);
  }, [selected, onSelectionChange]);

  // When the list refreshes after Save, stay on the same record and exit editing.
  // When the selected record is deleted, clear selection.
  const handleSelect = async (id: string) => {
    if (state.kind === 'editing' || state.kind === 'confirming-delete') {
      const ok = await openConfirmModal({
        title: 'Discard unsaved changes?',
        body: 'You have unsaved edits. Switching records will discard them.',
        confirmLabel: 'Discard',
        destructive: true,
      });
      if (!ok) return;
    }
    setSelectedId(id);
    setState({ kind: 'viewing' });
    setDraft({});
    setFieldErrors({});
    setFieldValidity({});
    setBanner(null);
  };

  const handleEdit = () => {
    if (!selected) return;
    // DEF-003: snapshot hook fires on every edit entry
    onEditSnapshot?.(selected);
    setDraft(selected as Partial<TRecord>);
    setState({ kind: 'editing' });
    setBanner(null);
  };

  const handleCancel = () => {
    setDraft({});
    setFieldErrors({});
    setFieldValidity({});
    setState({ kind: 'viewing' });
    setBanner(null);
  };

  const validate = (d: Partial<TRecord>): Record<string, string> => {
    const errs: Record<string, string> = {};
    for (const f of descriptor.fields) {
      const v = d[f.key];
      if (f.required && (v === undefined || v === null || v === '')) {
        errs[f.key] = 'Required';
        continue;
      }
      if (f.validate) {
        const msg = f.validate(v);
        if (msg) errs[f.key] = msg;
      }
    }
    return errs;
  };

  const handleSave = async () => {
    if (!selected) return;
    const errs = validate(draft);
    // Merge field-renderer errors (e.g. JSON parse) so Save blocks while
    // any field is in an unparseable state.
    const merged = { ...errs, ...fieldValidity };
    if (Object.keys(merged).length > 0) {
      setFieldErrors(merged);
      return;
    }
    setFieldErrors({});
    setState({ kind: 'saving' });
    try {
      // Strip id and version from the patch: id is passed separately as
      // the target, version is the optimistic-lock token (handed in as
      // expectedVersion). Leaving them in the patch would rely on the
      // server-side Zod schema silently stripping unknown keys, which is
      // an invisible correctness dependency — make it explicit here.
      const {
        id: _draftId,
        version: _draftVersion,
        ...rest
      } = draft as Partial<TRecord> & { id?: string; version?: number };
      void _draftId;
      void _draftVersion;
      // Enforce `fieldType: 'readonly'` at the save layer (FLX-225) — the
      // renderer only hides the input visually, so without this filter a
      // readonly key matching a real DB column would leak into the update.
      const readonlyKeys = new Set(
        descriptor.fields
          .filter((f) => f.fieldType === 'readonly')
          .map((f) => f.key as string)
      );
      const patch = Object.fromEntries(
        Object.entries(rest).filter(([k]) => !readonlyKeys.has(k))
      ) as Partial<TRecord>;
      await onSave(selected.id, patch, selected.version);
      setDraft({});
      setFieldValidity({});
      setState({ kind: 'viewing' });
      setBanner(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/optimistic|conflict|version/i.test(msg)) {
        setBanner({
          kind: 'error',
          conflict: true,
          text: 'This record was updated elsewhere. Click Refresh to load the latest, or continue editing and save again (will conflict until you refresh).',
        });
      } else {
        setBanner({ kind: 'error', text: `Save failed: ${msg}` });
      }
      setState({ kind: 'editing' });
    }
  };

  /**
   * Called when the user clicks Refresh inside a conflict banner.
   * The page owner supplies the actual refresh mechanism (e.g., tRPC query invalidation)
   * via the `onRefresh` prop. Parent's onRefresh should invalidate the list query so
   * `records` re-arrives with the latest server state; we then clear the draft and
   * return to viewing.
   */
  const handleRefresh = async () => {
    if (props.onRefresh) {
      await props.onRefresh();
    }
    setDraft({});
    setFieldErrors({});
    setState({ kind: 'viewing' });
    setBanner(null);
  };

  const handleDeleteRequest = () => setState({ kind: 'confirming-delete' });
  const handleDeleteAbort = () => setState({ kind: 'editing' });
  const handleDeleteConfirm = async () => {
    if (!selected || !onDelete) return;
    setState({ kind: 'deleting' });
    try {
      await onDelete(selected.id, selected.version);
      setSelectedId(null);
      setDraft({});
      setState({ kind: 'viewing' });
      setBanner(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBanner({ kind: 'error', text: msg });
      setState({ kind: 'editing' });
    }
  };

  const handleToggle = async (r: TRecord) => {
    if (!onToggleEnabled || !descriptor.toggleEnabledField) return;
    const current = Boolean(r[descriptor.toggleEnabledField]);
    try {
      await onToggleEnabled(r.id, !current, r.version);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBanner({ kind: 'error', text: `Toggle failed: ${msg}` });
    }
  };

  const getFieldValue = (field: FieldDescriptor<TRecord>): unknown => {
    if (state.kind === 'editing' || state.kind === 'saving') {
      if (field.key in draft) return draft[field.key];
    }
    return selected ? selected[field.key] : undefined;
  };

  const setFieldValue = (field: FieldDescriptor<TRecord>, value: unknown) => {
    setDraft({ ...draft, [field.key]: value });
    // Clear any stale error for this field — it'll be recomputed on Save.
    // Without this, an error surfaced by a prior failed Save sticks even
    // after the user has typed a fix.
    setFieldErrors((prev) => {
      if (!(field.key in prev)) return prev;
      const { [field.key]: _omit, ...rest } = prev;
      void _omit;
      return rest;
    });
  };

  if (isLoading) {
    return (
      <Card padding="p-0">
        <SkeletonTable />
      </Card>
    );
  }

  if (records.length === 0) {
    return (
      <Card padding="p-8">
        <EmptyState
          title={`No ${descriptor.entityName}s Yet`}
          description={`Seed data or create one to get started.`}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* LIST */}
      <Card padding="p-0">
        <ul
          className="divide-y divide-slate-700/20"
          data-testid="record-editor-list"
        >
          {records.map((r) => {
            const isSelected = r.id === selectedId;
            const enabled = descriptor.toggleEnabledField
              ? Boolean(r[descriptor.toggleEnabledField])
              : null;
            return (
              <li
                key={r.id}
                className={`flex items-center gap-4 px-5 py-3 cursor-pointer hover:bg-white/[0.03] transition-colors ${
                  isSelected ? 'bg-electric-violet/10' : ''
                }`}
                onClick={() => handleSelect(r.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white">
                    {descriptor.title(r)}
                  </div>
                  {descriptor.subtitle ? (
                    <div className="text-xs text-slate-500 truncate">
                      {descriptor.subtitle(r)}
                    </div>
                  ) : null}
                </div>
                {enabled !== null && onToggleEnabled ? (
                  <label
                    className="inline-flex items-center cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggle(r);
                    }}
                  >
                    <span
                      className={`w-10 h-5 rounded-full relative transition-colors ${
                        enabled ? 'bg-electric-violet' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          enabled ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </span>
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* DETAIL */}
      {selected ? (
        <Card padding="p-6">
          {banner ? (
            <div
              className={`mb-4 px-3 py-2 rounded-lg text-sm ${
                banner.kind === 'error'
                  ? 'bg-red-600/10 text-red-300 border border-red-600/30'
                  : 'bg-blue-600/10 text-blue-300 border border-blue-600/30'
              }`}
            >
              <div>{banner.text}</div>
              {banner.conflict ? (
                <button
                  type="button"
                  onClick={handleRefresh}
                  className="mt-2 px-3 py-1 rounded-md text-xs font-medium bg-red-600/20 text-red-200 hover:bg-red-600/30 border border-red-600/40"
                >
                  Refresh
                </button>
              ) : null}
            </div>
          ) : null}

          <h3 className="text-lg font-semibold text-white mb-1">
            {descriptor.title(selected)}
          </h3>
          {descriptor.subtitle ? (
            <p className="text-xs text-slate-500 mb-4">
              {descriptor.subtitle(selected)}
            </p>
          ) : null}

          {/* DEF-001 preview gate wraps the fields */}
          {previewGate && state.kind === 'viewing' ? (
            previewGate(selected)
          ) : (
            <div>
              {descriptor.fields.map((f) => (
                <RecordField
                  key={f.key}
                  field={f as FieldDescriptor<Record<string, unknown>>}
                  value={getFieldValue(f)}
                  editing={state.kind === 'editing' || state.kind === 'saving'}
                  onChange={(v) => setFieldValue(f, v)}
                  error={fieldErrors[f.key] ?? fieldValidity[f.key]}
                  onValidityChange={handleValidityChange}
                />
              ))}
            </div>
          )}

          <RecordActionsBar
            state={state}
            entityName={descriptor.entityName}
            canEdit={canEdit(selected)}
            canDelete={Boolean(onDelete) && canDelete(selected)}
            onEdit={handleEdit}
            onSave={handleSave}
            onCancel={handleCancel}
            onDeleteRequest={handleDeleteRequest}
            onDeleteConfirm={handleDeleteConfirm}
            onDeleteAbort={handleDeleteAbort}
          />
        </Card>
      ) : (
        <Card padding="p-8">
          <EmptyState
            title="Select a record to view details"
            description={`Click a row above to view or edit the ${descriptor.entityName}.`}
          />
        </Card>
      )}
    </div>
  );
}
