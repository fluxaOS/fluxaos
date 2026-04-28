// src/app/[org]/[user]/[project]/settings/drivers/descriptor.ts
import type { RecordDescriptor } from '@/components/record-editor/types';

// DriverRecord must expose every runtime-consumed column:
// - outputFormatFlag is read by command-builder.ts
// - contextLayout is read by stage-runner.ts to choose instructions file name
// JSON-valued fields (defaultArgs, envVars, extraArgs, contextLayout) are
// edited via the jsonb field type — the renderer parses on every keystroke
// and blocks Save until the JSON is valid (FLX-38).
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
  // JSON-valued columns — see field descriptors below for shape constraints
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
    {
      key: 'modelFlag',
      label: 'Model flag',
      fieldType: 'text',
      placeholder: '--model',
    },
    {
      key: 'dirFlag',
      label: 'Directory flag',
      fieldType: 'text',
      placeholder: '--cwd',
    },
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
    // JSON fields — server-side Zod validates the *shape* (string[],
    // record<string,string>, record<string,unknown>, unknown). The renderer
    // only validates JSON parseability — shape errors will surface as a
    // tRPC error banner if the user enters something the column rejects.
    {
      key: 'defaultArgs',
      label: 'Default args (JSON array of strings)',
      fieldType: 'jsonb',
      placeholder: '["--print", "--output-format", "json"]',
      validate: (v) => {
        if (v === undefined || v === null) return null;
        if (!Array.isArray(v) || !v.every((item) => typeof item === 'string')) {
          return 'Must be a JSON array of strings';
        }
        return null;
      },
    },
    {
      key: 'envVars',
      label: 'Env vars (JSON object of string→string)',
      fieldType: 'jsonb',
      placeholder: '{ "ANTHROPIC_API_KEY": "..." }',
      validate: (v) => {
        if (v === undefined || v === null) return null;
        if (
          typeof v !== 'object' ||
          Array.isArray(v) ||
          !Object.values(v as Record<string, unknown>).every(
            (val) => typeof val === 'string'
          )
        ) {
          return 'Must be a JSON object with string values';
        }
        return null;
      },
    },
    {
      key: 'extraArgs',
      label: 'Extra args (JSON object)',
      fieldType: 'jsonb',
      placeholder: '{ "--verbose": true }',
      validate: (v) => {
        if (v === undefined || v === null) return null;
        if (typeof v !== 'object' || Array.isArray(v)) {
          return 'Must be a JSON object';
        }
        return null;
      },
    },
    {
      key: 'contextLayout',
      label: 'Context layout (JSON)',
      fieldType: 'jsonb',
      required: true,
      placeholder: '{ "instructionsFile": "CLAUDE.md" }',
    },
    { key: 'version', label: 'Version', fieldType: 'readonly' },
  ],
  toggleEnabledField: 'isEnabled',
};
