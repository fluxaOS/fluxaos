// src/app/[org]/[user]/[project]/settings/cron/page.tsx
'use client';

import { notFound, useParams } from 'next/navigation';
import { useState } from 'react';
import { Card } from '@/components/card';
import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { useCanDelete, useCanEdit } from '@/lib/auth/use-viewer-role';
import { trpc } from '@/lib/trpc/client';
import { type CronJobRecord, cronJobDescriptor } from './descriptor';

export default function CronSettingsPage() {
  const params = useParams<{ projectUuid: string }>();
  const utils = trpc.useUtils();

  // FLX-244: resolve the project from the URL slug, not the first DB row.
  const currentProjectQuery = trpc.project.getById.useQuery({
    id: params.projectUuid,
  });
  const currentProject = currentProjectQuery.data ?? null;
  if (currentProjectQuery.isSuccess && !currentProject) {
    notFound();
  }
  const projectId = currentProject?.id;

  const listQuery = trpc.cron.listByProject.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const updateMutation = trpc.cron.update.useMutation();
  const createMutation = trpc.cron.create.useMutation();
  const deleteMutation = trpc.cron.delete.useMutation();

  const records = (listQuery.data ?? []) as unknown as CronJobRecord[];

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newCron, setNewCron] = useState('*/5 * * * *');
  const [newActionType, setNewActionType] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const onSave = async (
    id: string,
    patch: Partial<CronJobRecord>,
    expectedVersion: number
  ) => {
    const {
      lastRunAt: _last,
      nextRunAt: _next,
      projectId: _pid,
      ...allowed
    } = patch as Partial<CronJobRecord>;
    void _last;
    void _next;
    void _pid;
    await updateMutation.mutateAsync({
      id,
      version: expectedVersion,
      ...(allowed as Record<string, unknown>),
    });
    if (projectId) await utils.cron.listByProject.invalidate({ projectId });
  };

  const onToggleEnabled = async (
    id: string,
    enabled: boolean,
    expectedVersion: number
  ) => {
    await updateMutation.mutateAsync({
      id,
      version: expectedVersion,
      isEnabled: enabled,
    });
    if (projectId) await utils.cron.listByProject.invalidate({ projectId });
  };

  const onDelete = async (id: string, expectedVersion: number) => {
    await deleteMutation.mutateAsync({ id, version: expectedVersion });
    if (projectId) await utils.cron.listByProject.invalidate({ projectId });
  };

  const onCreate = async () => {
    setCreateError(null);
    if (!projectId) {
      setCreateError('No project available — cannot create cron job.');
      return;
    }
    try {
      await createMutation.mutateAsync({
        projectId,
        name: newName.trim(),
        slug: newSlug.trim(),
        cronExpression: newCron.trim(),
        actionType: newActionType.trim(),
      });
      setNewName('');
      setNewSlug('');
      setNewCron('*/5 * * * *');
      setNewActionType('');
      setShowCreate(false);
      await utils.cron.listByProject.invalidate({ projectId });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  };

  // FLX-12: role-based gating; server enforcement via protectedMutation.
  const canEdit = useCanEdit();
  const canDelete = useCanDelete();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cron Jobs"
        description="Scheduled job definitions. Catalog only — runtime engagement is a follow-up."
        action={
          projectId ? (
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all"
              onClick={() => setShowCreate((v) => !v)}
            >
              {showCreate ? 'Cancel' : 'New Cron Job'}
            </button>
          ) : undefined
        }
      />

      {showCreate && projectId ? (
        <Card padding="p-6">
          <h3 className="text-sm font-semibold text-white mb-3">
            New Cron Job
          </h3>
          {createError ? (
            <div className="mb-3 px-3 py-2 rounded-lg text-sm bg-red-600/10 text-red-300 border border-red-600/30">
              {createError}
            </div>
          ) : null}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                aria-label="Cron job name"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Slug <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                aria-label="Cron job slug"
                placeholder="kebab-case"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Cron expression <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                aria-label="Cron job cron expression"
                placeholder="*/5 * * * *"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white font-mono"
                value={newCron}
                onChange={(e) => setNewCron(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Action type <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                aria-label="Cron job action type"
                placeholder="queue-pipeline | rotate-tokens | …"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newActionType}
                onChange={(e) => setNewActionType(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all disabled:opacity-50"
              disabled={
                !newName.trim() ||
                !newSlug.trim() ||
                !newCron.trim() ||
                !newActionType.trim() ||
                createMutation.isPending
              }
              onClick={onCreate}
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </Card>
      ) : null}

      <RecordEditor<CronJobRecord>
        descriptor={cronJobDescriptor}
        records={records}
        isLoading={listQuery.isLoading}
        onSave={onSave}
        onDelete={onDelete}
        onToggleEnabled={onToggleEnabled}
        onRefresh={async () => {
          if (projectId)
            await utils.cron.listByProject.invalidate({ projectId });
        }}
        canEdit={() => canEdit}
        canDelete={() => canDelete}
      />
    </div>
  );
}
