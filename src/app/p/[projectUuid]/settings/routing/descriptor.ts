import type { RecordDescriptor } from '@/components/record-editor/types';

export type RoutingProfileRecord = {
  id: string;
  version: number;
  name: string;
  description: string | null;
  isDefault: boolean;
};

export const routingProfileDescriptor: RecordDescriptor<RoutingProfileRecord> =
  {
    entityName: 'routing profile',
    title: (p) => p.name,
    subtitle: (p) => (p.isDefault ? 'default' : (p.description ?? '')),
    fields: [
      { key: 'name', label: 'Name', fieldType: 'text', required: true },
      { key: 'description', label: 'Description', fieldType: 'textarea' },
    ],
  };
