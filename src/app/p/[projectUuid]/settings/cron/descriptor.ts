// src/app/[org]/[user]/[project]/settings/cron/descriptor.ts
import type { RecordDescriptor } from '@/components/record-editor/types';

export type CronJobRecord = {
  id: string;
  version: number;
  projectId: string;
  name: string;
  slug: string;
  cronExpression: string;
  actionType: string;
  actionPayload: unknown;
  isEnabled: boolean;
  lastRunAt: string | Date | null;
  nextRunAt: string | Date | null;
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CRON_RE = /^(\S+\s+){4,5}\S+$/;

export const cronJobDescriptor: RecordDescriptor<CronJobRecord> = {
  entityName: 'cron job',
  title: (j) => j.name,
  subtitle: (j) => `${j.cronExpression} · ${j.actionType}`,
  fields: [
    { key: 'name', label: 'Name', fieldType: 'text', required: true },
    {
      key: 'slug',
      label: 'Slug',
      fieldType: 'text',
      required: true,
      placeholder: 'kebab-case',
      validate: (v) => {
        if (typeof v !== 'string' || !v) return 'Required';
        return SLUG_RE.test(v) ? null : 'Must be kebab-case';
      },
    },
    {
      key: 'cronExpression',
      label: 'Cron expression',
      fieldType: 'text',
      required: true,
      placeholder: '*/5 * * * *',
      validate: (v) => {
        if (typeof v !== 'string' || !v) return 'Required';
        return CRON_RE.test(v.trim())
          ? null
          : 'Must be 5 or 6 space-separated fields';
      },
    },
    {
      key: 'actionType',
      label: 'Action type',
      fieldType: 'text',
      required: true,
      placeholder: 'e.g. queue-pipeline | rotate-tokens',
    },
    {
      key: 'actionPayload',
      label: 'Action payload (JSON)',
      fieldType: 'jsonb',
    },
    { key: 'lastRunAt', label: 'Last run at', fieldType: 'readonly' },
    { key: 'nextRunAt', label: 'Next run at', fieldType: 'readonly' },
    { key: 'version', label: 'Version', fieldType: 'readonly' },
  ],
  toggleEnabledField: 'isEnabled',
};
