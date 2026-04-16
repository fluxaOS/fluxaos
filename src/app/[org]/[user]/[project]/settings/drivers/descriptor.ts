// src/app/[org]/[user]/[project]/settings/drivers/descriptor.ts
import type { RecordDescriptor } from '@/components/record-editor/types';

// DriverRecord must expose every runtime-consumed column:
// - outputFormatFlag is read by command-builder.ts
// - contextLayout is read by stage-runner.ts to choose instructions file name
// JSON-valued fields (defaultArgs, envVars, extraArgs, contextLayout) are
// displayed readonly for MVP; DEF-006 tracks a structured editor upgrade.
export type DriverRecord = {
  id: string;
  version: number;
  name: string;
  slug: string;
  binary: string;
  modelFlag: string | null;
  dirFlag: string | null;
  sessionNameFlag: string | null;
  promptTransport: string;
  outputFormat: string;
  outputFormatFlag: string | null;
  promptSendDelayMs: number;
  probeCommand: string | null;
  issuePromptTemplate: string | null;
  queuePromptTemplate: string | null;
  notes: string | null;
  isEnabled: boolean;
  // JSON-valued columns — readonly in MVP (DEF-006)
  defaultArgs: unknown;
  envVars: unknown;
  extraArgs: unknown;
  contextLayout: unknown;
};

export const driverDescriptor: RecordDescriptor<DriverRecord> = {
  entityName: 'driver',
  title: (d) => d.name,
  subtitle: (d) => d.slug,
  fields: [
    { key: 'name', label: 'Name', fieldType: 'text', required: true },
    { key: 'slug', label: 'Slug', fieldType: 'text', required: true },
    {
      key: 'binary',
      label: 'Binary',
      fieldType: 'text',
      required: true,
      placeholder: 'claude',
    },
    { key: 'modelFlag', label: 'Model flag', fieldType: 'text', placeholder: '--model' },
    { key: 'dirFlag', label: 'Directory flag', fieldType: 'text', placeholder: '--cwd' },
    { key: 'sessionNameFlag', label: 'Session-name flag', fieldType: 'text' },
    {
      key: 'promptTransport',
      label: 'Prompt transport',
      fieldType: 'text',
      placeholder: 'stdin | argv | file',
    },
    {
      key: 'outputFormat',
      label: 'Output format',
      fieldType: 'text',
      placeholder: 'stream-json | text',
    },
    {
      key: 'outputFormatFlag',
      label: 'Output-format flag',
      fieldType: 'text',
      placeholder: '--output-format',
    },
    {
      key: 'promptSendDelayMs',
      label: 'Prompt send delay (ms)',
      fieldType: 'text',
    },
    { key: 'probeCommand', label: 'Probe command', fieldType: 'text' },
    { key: 'notes', label: 'Notes', fieldType: 'textarea' },
    {
      key: 'issuePromptTemplate',
      label: 'Issue prompt template',
      fieldType: 'textarea-large',
    },
    {
      key: 'queuePromptTemplate',
      label: 'Queue prompt template',
      fieldType: 'textarea-large',
    },
    // JSON fields — readonly in MVP; DEF-006 adds a structured editor later
    { key: 'defaultArgs', label: 'Default args (JSON)', fieldType: 'readonly' },
    { key: 'envVars', label: 'Env vars (JSON)', fieldType: 'readonly' },
    { key: 'extraArgs', label: 'Extra args (JSON)', fieldType: 'readonly' },
    { key: 'contextLayout', label: 'Context layout (JSON)', fieldType: 'readonly' },
    { key: 'version', label: 'Version', fieldType: 'readonly' },
  ],
  toggleEnabledField: 'isEnabled',
};
