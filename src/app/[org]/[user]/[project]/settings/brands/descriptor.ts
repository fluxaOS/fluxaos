import type { RecordDescriptor } from '@/components/record-editor/types';

export type BrandRecord = {
  id: string;
  version: number;
  orgId: string;
  projectId: string | null;
  name: string;
  colors: unknown;
  fonts: unknown;
  toneOfVoice: string | null;
  styleGuide: string | null;
  logoUrl: string | null;
};

export const brandDescriptor: RecordDescriptor<BrandRecord> = {
  entityName: 'brand',
  title: (b) => b.name,
  subtitle: (b) => (b.projectId ? 'project' : 'organization'),
  fields: [
    { key: 'name', label: 'Name', fieldType: 'text', required: true },
    { key: 'toneOfVoice', label: 'Tone of voice', fieldType: 'textarea' },
    { key: 'styleGuide', label: 'Style guide', fieldType: 'textarea' },
    { key: 'colors', label: 'Colors JSON', fieldType: 'jsonb' },
    { key: 'fonts', label: 'Fonts JSON', fieldType: 'jsonb' },
    { key: 'logoUrl', label: 'Logo URL', fieldType: 'text' },
  ],
};
