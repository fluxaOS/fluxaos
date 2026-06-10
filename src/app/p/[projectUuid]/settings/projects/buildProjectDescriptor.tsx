// src/app/p/[projectUuid]/settings/projects/buildProjectDescriptor.tsx
//
// FLX-207 + FLX-229: the Projects descriptor is built per-render because
// FK dropdown options (pipelines, brands) come from tRPC queries. The
// page-level component memoizes the result so RecordEditor's internal
// effects don't churn between renders that don't actually change options.
import { RepoUrlField } from '@/components/record-editor/RepoUrlField';
import type {
  RecordDescriptor,
  SelectIdOption,
} from '@/components/record-editor/types';
import type { ProjectRecord } from './descriptor';

export type BuildProjectDescriptorInput = {
  pipelineOptions: readonly SelectIdOption[];
  brandOptions: readonly SelectIdOption[];
};

export function buildProjectDescriptor({
  pipelineOptions,
  brandOptions,
}: BuildProjectDescriptorInput): RecordDescriptor<ProjectRecord> {
  return {
    entityName: 'project',
    title: (p) => p.name,
    // FLX-271: project.slug dropped — the UUID is the only stable identity.
    subtitle: (p) => p.id,
    fields: [
      { key: 'name', label: 'Name', fieldType: 'text', required: true },
      {
        key: 'repoUrl',
        label: 'Repo URL',
        fieldType: 'text',
        placeholder: 'https://github.com/owner/repo',
        customRenderer: (props) => <RepoUrlField {...props} />,
        helpText:
          'The remote repository this project tracks. Click Validate before saving.',
      },
      {
        key: 'defaultBranch',
        label: 'Default branch',
        fieldType: 'text',
        required: true,
      },
      {
        key: 'defaultPipelineId',
        label: 'Default pipeline',
        fieldType: 'select-id',
        selectIdOptions: pipelineOptions,
        nullOptionLabel: '(none)',
        helpText: 'Pipeline used when an issue does not specify one.',
      },
      {
        key: 'brandId',
        label: 'Default brand',
        fieldType: 'select-id',
        selectIdOptions: brandOptions,
        nullOptionLabel: '(no brand)',
        helpText:
          'Brand applied to issues filed under this project when none is specified.',
      },
      {
        key: 'targetRepoPath',
        label: 'Target repo path',
        fieldType: 'text',
        placeholder: '/mnt/dev/<owner>/<repo>',
        helpText:
          "Absolute path to a local clone of this project's target repo on main. Stage runs use it to acquire an isolation worktree.",
      },
    ],
  };
}
