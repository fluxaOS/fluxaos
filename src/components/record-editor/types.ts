import type { ReactNode } from 'react';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'textarea-large'
  | 'tags'
  | 'boolean'
  | 'jsonb'
  | 'readonly';

export type FieldDescriptor<TRecord> = {
  /** Typed key on the record row */
  key: keyof TRecord & string;
  /** UI label for the field */
  label: string;
  /** Rendering hint */
  fieldType: FieldType;
  /** When true, Save blocks on empty value */
  required?: boolean;
  /** Placeholder text for text/textarea inputs */
  placeholder?: string;
  /**
   * Per-field validator. Returns null if valid, error message if invalid.
   * Runs client-side before submit.
   */
  validate?: (value: unknown) => string | null;
  /**
   * When true, the value is blurred in the viewing state with a Preview
   * button overlay. Edit mode bypasses the blur. Used for prompt templates,
   * system prompts, and similar content that may be sensitive in
   * demos/screenshots. (FLX-11)
   */
  sensitive?: boolean;
};

export type RecordDescriptor<TRecord> = {
  /** Lowercase entity name, used in messages ("delete this {entityName}?") */
  entityName: string;
  /** Primary label shown in the list row */
  title: (r: TRecord) => string;
  /** Secondary label shown next to the title (slug, scope, etc.) */
  subtitle?: (r: TRecord) => string;
  /** Field list drives what gets shown in the detail panel */
  fields: FieldDescriptor<TRecord>[];
  /** Key of a boolean field that renders as a list-row toggle (optional) */
  toggleEnabledField?: keyof TRecord & string;
};

export type RecordWithVersion = {
  id: string;
  version: number;
};

export type RecordEditorProps<TRecord extends RecordWithVersion> = {
  descriptor: RecordDescriptor<TRecord>;
  records: TRecord[];
  isLoading: boolean;

  // Required mutations
  onSave: (
    id: string,
    patch: Partial<TRecord>,
    expectedVersion: number
  ) => Promise<void>;

  // Optional mutations — absence hides the action
  onDelete?: (id: string, expectedVersion: number) => Promise<void>;
  onToggleEnabled?: (
    id: string,
    enabled: boolean,
    expectedVersion: number
  ) => Promise<void>;

  /**
   * Called when the user clicks the "Refresh" button inside a conflict banner.
   * Implementors should invalidate the list query so `records` arrives fresh
   * from the server.
   */
  onRefresh?: () => Promise<void>;

  // Deferred-hook slots (no-ops today; wire to features later)
  /** DEF-001 — openclaw-style preview blur. Return a wrapping node. */
  previewGate?: (record: TRecord) => ReactNode;
  /** DEF-002 — role check for edit button visibility */
  canEdit?: (record: TRecord) => boolean;
  /** DEF-002 — role check for delete button visibility */
  canDelete?: (record: TRecord) => boolean;
  /** DEF-003 — fires when user enters edit mode so history can snapshot */
  onEditSnapshot?: (record: TRecord) => void;
};
