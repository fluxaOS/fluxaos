// src/app/[org]/[user]/[project]/settings/projects/page.tsx
'use client';

import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { trpc } from '@/lib/trpc/client';
import { type ProjectRecord, projectDescriptor } from './descriptor';

export default function ProjectsSettingsPage() {
  const utils = trpc.useUtils();
  const projectsQuery = trpc.project.list.useQuery();
  const envQuery = trpc.system.env.getPublic.useQuery();
  const pipelinesQuery = trpc.pipeline.list.useQuery();

  const updateMutation = trpc.project.update.useMutation();

  const projects = projectsQuery.data ?? [];
  const pipelines = pipelinesQuery.data ?? [];
  const envValue = envQuery.data?.FLUXAOS_TARGET_REPO_PATH ?? null;

  const records: ProjectRecord[] = projects.map((p) => {
    const pipe = p.defaultPipelineId
      ? pipelines.find((x) => x.id === p.defaultPipelineId)
      : null;
    return {
      id: p.id,
      version: 1,
      name: p.name,
      slug: p.slug,
      repoUrl: p.repoUrl,
      defaultBranch: p.defaultBranch,
      defaultPipelineName:
        pipe?.name ?? '(none — set one from the Pipelines tab)',
      targetRepoPath: envValue ?? '(not set — daemon will refuse to acquire)',
    };
  });

  const onSave = async (
    id: string,
    patch: Partial<ProjectRecord>,
    _expectedVersion: number
  ) => {
    // Strip derived/readonly fields — the router only accepts the raw
    // project columns. defaultPipelineName / targetRepoPath are UI-only.
    const {
      defaultPipelineName: _dp,
      targetRepoPath: _trp,
      ...writable
    } = patch;
    await updateMutation.mutateAsync({
      id,
      ...(writable as Record<string, unknown>),
    });
    await utils.project.list.invalidate();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects"
        description="Configure the target repository and default pipeline. The target repo path is env-backed (FLUXAOS_TARGET_REPO_PATH) for alpha."
      />

      <RecordEditor<ProjectRecord>
        descriptor={projectDescriptor}
        records={records}
        isLoading={projectsQuery.isLoading}
        onSave={onSave}
        onRefresh={async () => {
          await utils.project.list.invalidate();
        }}
      />
    </div>
  );
}
