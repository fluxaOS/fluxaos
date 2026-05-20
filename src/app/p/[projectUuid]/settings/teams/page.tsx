'use client';

import { notFound, useParams } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { CreateEntityForm } from '@/components/record-editor/CreateEntityForm';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { useCanDelete, useCanEdit } from '@/lib/auth/use-viewer-role';
import { trpc } from '@/lib/trpc/client';
import { type TeamRecord, teamDescriptor } from './descriptor';

export default function TeamsSettingsPage() {
  const params = useParams<{ org: string; user: string; project: string }>();
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);

  // FLX-244: resolve the project from the URL slug, not the first DB row.
  const currentProjectQuery = trpc.project.getBySlug.useQuery({
    slug: params.project,
  });
  const currentProject = currentProjectQuery.data ?? null;
  if (currentProjectQuery.isSuccess && !currentProject) {
    notFound();
  }
  const projectId = currentProject?.id;

  const teamsQuery = trpc.team.listByProject.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const records = (teamsQuery.data ?? []) as unknown as TeamRecord[];

  const updateMutation = trpc.team.update.useMutation();
  const deleteMutation = trpc.team.delete.useMutation();
  const createMutation = trpc.team.create.useMutation();

  const canEdit = useCanEdit();
  const canDelete = useCanDelete();

  const onSave = async (
    id: string,
    patch: Partial<TeamRecord>,
    expectedVersion: number
  ) => {
    await updateMutation.mutateAsync({
      id,
      version: expectedVersion,
      ...(patch as Record<string, unknown>),
    });
    await utils.team.listByProject.invalidate();
  };

  const onDelete = async (id: string, expectedVersion: number) => {
    await deleteMutation.mutateAsync({ id, version: expectedVersion });
    await utils.team.listByProject.invalidate();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Teams"
        description="Manage teams and their access to projects"
      />

      {projectId ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? 'Cancel New Team' : 'New Team'}
          </button>
        </div>
      ) : null}

      {showCreate && projectId ? (
        <CreateEntityForm
          title="New Team"
          fields={[
            { key: 'name', label: 'Name', required: true },
            { key: 'description', label: 'Description' },
          ]}
          onSubmit={async (vals) => {
            await createMutation.mutateAsync({
              projectId,
              name: vals.name.trim(),
              description: vals.description.trim() || undefined,
            });
            setShowCreate(false);
            await utils.team.listByProject.invalidate();
          }}
          onCancel={() => setShowCreate(false)}
        />
      ) : null}

      <RecordEditor<TeamRecord>
        descriptor={teamDescriptor}
        records={records}
        isLoading={teamsQuery.isLoading}
        onSave={onSave}
        onDelete={onDelete}
        onRefresh={async () => {
          await utils.team.listByProject.invalidate();
        }}
        canEdit={() => canEdit}
        canDelete={() => canDelete}
      />
    </div>
  );
}
