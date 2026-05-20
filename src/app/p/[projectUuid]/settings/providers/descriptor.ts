import type { RecordDescriptor } from '@/components/record-editor/types';

export type ProviderRecord = {
  id: string;
  version: number;
  name: string;
  type: string;
  baseUrl: string | null;
  apiKeyRef: string | null;
  isHealthy: boolean;
};

export const providerDescriptor: RecordDescriptor<ProviderRecord> = {
  entityName: 'provider',
  title: (p) => p.name,
  subtitle: (p) => p.type,
  fields: [
    { key: 'name', label: 'Name', fieldType: 'text', required: true },
    {
      key: 'type',
      label: 'Type',
      fieldType: 'text',
      required: true,
      placeholder: 'provider slug',
    },
    { key: 'baseUrl', label: 'Base URL', fieldType: 'text' },
    {
      key: 'apiKeyRef',
      label: 'API Key Reference',
      fieldType: 'text',
      placeholder: 'env:API_KEY_NAME',
    },
  ],
};
