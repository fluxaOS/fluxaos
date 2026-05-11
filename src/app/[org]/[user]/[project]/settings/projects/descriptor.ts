// src/app/[org]/[user]/[project]/settings/projects/descriptor.ts
import type { RecordDescriptor } from '@/components/record-editor/types';

// ProjectRecord extends the raw project row with one UI-only derived
// field: `defaultPipelineName` (resolved from pipeline list). It's
// readonly in the editor — `defaultPipelineName` is changed via the
// Pipelines tab's "Set as default" button. `targetRepoPath` is a real
// project column (FLX-221) — readonly for now until FLX-207 makes the
// form editable.
//
// RecordEditor requires { id, version: number } per RecordWithVersion.
// The project table has no `version` column; the page hydrates with
// `version: 1` so optimistic-locking-free updates still satisfy the
// editor's type contract.
export type ProjectRecord = {
  id: string;
  version: number;
  name: string;
  slug: string;
  repoUrl: string | null;
  defaultBranch: string;
  defaultPipelineName: string;
  targetRepoPath: string | null;
};

export const projectDescriptor: RecordDescriptor<ProjectRecord> = {
  entityName: 'project',
  title: (p) => p.name,
  subtitle: (p) => p.slug,
  fields: [
    { key: 'name', label: 'Name', fieldType: 'text', required: true },
    { key: 'slug', label: 'Slug', fieldType: 'text', required: true },
    {
      key: 'repoUrl',
      label: 'Repo URL',
      fieldType: 'text',
      placeholder: 'https://github.com/owner/repo',
    },
    {
      key: 'defaultBranch',
      label: 'Default branch',
      fieldType: 'text',
      required: true,
    },
    {
      key: 'defaultPipelineName',
      label: 'Default pipeline',
      fieldType: 'readonly',
    },
    {
      key: 'targetRepoPath',
      label: 'Target repo path',
      fieldType: 'readonly',
    },
  ],
};
