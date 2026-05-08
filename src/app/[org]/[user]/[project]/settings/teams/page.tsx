'use client';

import { useState } from 'react';
import { Card } from '@/components/card';
import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { useCanDelete, useCanEdit } from '@/lib/auth/use-viewer-role';
import { trpc } from '@/lib/trpc/client';
import { type TeamRecord, teamDescriptor } from './descriptor';

export default function TeamsSettingsPage() {
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const projectsQuery = trpc.project.listByOrg.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const projectId = projectsQuery.data?.[0]?.id;

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

  const onCreate = async () => {
    if (!newName.trim() || !projectId) return;
    await createMutation.mutateAsync({
      projectId,
      name: newName.trim(),
      description: newDescription.trim() || undefined,
    });
    setNewName('');
    setNewDescription('');
    setShowCreate(false);
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

      {showCreate ? (
        <Card padding="p-6">
          <h3 className="text-sm font-semibold text-white mb-3">New Team</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                aria-label="Team name"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Description
              </label>
              <input
                aria-label="Team description"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all disabled:opacity-50"
              disabled={!newName.trim() || createMutation.isPending}
              onClick={onCreate}
            >
              Create
            </button>
          </div>
        </Card>
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
