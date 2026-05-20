// src/app/[org]/[user]/[project]/settings/skills/descriptor.ts
import type { RecordDescriptor } from '@/components/record-editor/types';

export type SkillRecord = {
  id: string;
  version: number;
  name: string;
  scope: string;
  description: string | null;
  promptTemplate: string | null;
  tags: unknown;
};

export const skillDescriptor: RecordDescriptor<SkillRecord> = {
  entityName: 'skill',
  title: (s) => s.name,
  subtitle: (s) => s.scope,
  fields: [
    { key: 'name', label: 'Name', fieldType: 'text', required: true },
    { key: 'description', label: 'Description', fieldType: 'textarea' },
    { key: 'tags', label: 'Tags', fieldType: 'tags' },
    {
      key: 'promptTemplate',
      label: 'Prompt template',
      fieldType: 'textarea-large',
      // FLX-11: prompt templates often contain proprietary IP or
      // demo-sensitive language — gate behind Preview by default.
      sensitive: true,
    },
    { key: 'version', label: 'Version', fieldType: 'readonly' },
  ],
  // No toggleEnabledField — skills do not have isEnabled today.
};
