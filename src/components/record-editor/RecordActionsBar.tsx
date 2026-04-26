// src/components/record-editor/RecordActionsBar.tsx
'use client';

type ActionsState =
  | { kind: 'viewing' }
  | { kind: 'editing' }
  | { kind: 'saving' }
  | { kind: 'confirming-delete' }
  | { kind: 'deleting' };

type Props = {
  state: ActionsState;
  entityName: string;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDeleteRequest: () => void;
  onDeleteConfirm: () => void;
  onDeleteAbort: () => void;
};

export function RecordActionsBar(props: Props) {
  const {
    state,
    entityName,
    canEdit,
    canDelete,
    onEdit,
    onSave,
    onCancel,
    onDeleteRequest,
    onDeleteConfirm,
    onDeleteAbort,
  } = props;

  const btn =
    'px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed';
  const primary = `${btn} bg-electric-violet text-white hover:bg-accent-hover`;
  const secondary = `${btn} bg-slate-700 text-slate-200 hover:bg-slate-600`;
  const danger = `${btn} bg-red-600/20 text-red-300 hover:bg-red-600/30 border border-red-600/30`;

  if (state.kind === 'viewing') {
    return (
      <div className="flex gap-2 mt-4">
        <button
          type="button"
          className={primary}
          onClick={onEdit}
          disabled={!canEdit}
        >
          Edit
        </button>
      </div>
    );
  }

  if (state.kind === 'editing') {
    return (
      <div className="flex gap-2 mt-4">
        <button type="button" className={primary} onClick={onSave}>
          Save
        </button>
        <button type="button" className={secondary} onClick={onCancel}>
          Cancel
        </button>
        {canDelete ? (
          <button
            type="button"
            className={`${danger} ml-auto`}
            onClick={onDeleteRequest}
          >
            Delete
          </button>
        ) : null}
      </div>
    );
  }

  if (state.kind === 'saving') {
    return (
      <div className="flex gap-2 mt-4">
        <button type="button" className={primary} disabled>
          Saving…
        </button>
        <button type="button" className={secondary} disabled>
          Cancel
        </button>
      </div>
    );
  }

  if (state.kind === 'confirming-delete') {
    return (
      <div className="mt-4 p-3 rounded-lg bg-red-600/10 border border-red-600/30">
        <p className="text-sm text-red-200 mb-2">
          Delete this {entityName}? This cannot be undone.
        </p>
        <div className="flex gap-2">
          <button type="button" className={danger} onClick={onDeleteConfirm}>
            Yes, delete
          </button>
          <button type="button" className={secondary} onClick={onDeleteAbort}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // state.kind === 'deleting'
  return (
    <div className="flex gap-2 mt-4">
      <button type="button" className={danger} disabled>
        Deleting…
      </button>
    </div>
  );
}

export type { ActionsState };
