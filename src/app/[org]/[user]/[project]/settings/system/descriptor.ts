// src/app/[org]/[user]/[project]/settings/system/descriptor.ts
import type { RecordDescriptor } from '@/components/record-editor/types';

export type ConfigEntryRecord = {
  id: string;
  version: number;
  scope: string;
  projectId: string | null;
  key: string;
  value: unknown;
  previousValue: unknown;
  changedBy: string | null;
};

export const configEntryDescriptor: RecordDescriptor<ConfigEntryRecord> = {
  entityName: 'config entry',
  title: (c) => c.key,
  subtitle: (c) =>
    c.scope === 'global'
      ? 'global'
      : `${c.scope}${c.projectId ? ` · project ${c.projectId.slice(0, 8)}` : ''}`,
  fields: [
    { key: 'key', label: 'Key', fieldType: 'text', required: true },
    {
      key: 'scope',
      label: 'Scope',
      fieldType: 'text',
      required: true,
      placeholder: 'global | project | user',
    },
    {
      key: 'value',
      label: 'Value (JSON)',
      fieldType: 'jsonb',
      required: true,
    },
    {
      key: 'previousValue',
      label: 'Previous value (JSON, readonly)',
      fieldType: 'jsonb',
    },
    { key: 'changedBy', label: 'Changed by', fieldType: 'text' },
    { key: 'version', label: 'Version', fieldType: 'readonly' },
  ],
};
