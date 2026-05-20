import type { RecordDescriptor } from '@/components/record-editor/types';

export type TeamRecord = {
  id: string;
  version: number;
  name: string;
  description: string | null;
};

export const teamDescriptor: RecordDescriptor<TeamRecord> = {
  entityName: 'team',
  title: (t) => t.name,
  subtitle: (t) => t.description ?? '',
  fields: [
    { key: 'name', label: 'Name', fieldType: 'text', required: true },
    { key: 'description', label: 'Description', fieldType: 'textarea' },
  ],
};
