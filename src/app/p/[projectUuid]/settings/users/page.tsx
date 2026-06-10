// src/app/p/[projectUuid]/settings/users/page.tsx
'use client';

import { notFound, useParams } from 'next/navigation';
import { useState } from 'react';
import { Card } from '@/components/card';
import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { useCanDelete, useCanEdit } from '@/lib/auth/use-viewer-role';
import { trpc } from '@/lib/trpc/client';
import { type UserRecord, userDescriptor } from './descriptor';

export default function UsersSettingsPage() {
  const params = useParams<{ projectUuid: string }>();
  const utils = trpc.useUtils();

  // FLX-244: resolve the org from the URL project UUID, not the first DB row.
  const currentProjectQuery = trpc.project.getById.useQuery({
    id: params.projectUuid,
  });
  const currentProject = currentProjectQuery.data ?? null;
  if (currentProjectQuery.isSuccess && !currentProject) {
    notFound();
  }
  const orgId = currentProject?.orgId;

  const listQuery = trpc.user.listByOrg.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const updateMutation = trpc.user.update.useMutation();
  const createMutation = trpc.user.create.useMutation();
  const deleteMutation = trpc.user.delete.useMutation();

  const records = (listQuery.data ?? []) as unknown as UserRecord[];

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newAvatarUrl, setNewAvatarUrl] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  const onSave = async (
    id: string,
    patch: Partial<UserRecord>,
    expectedVersion: number
  ) => {
    await updateMutation.mutateAsync({
      id,
      version: expectedVersion,
      ...(patch as Record<string, unknown>),
    });
    if (orgId) await utils.user.listByOrg.invalidate({ orgId });
  };

  const onDelete = async (id: string, expectedVersion: number) => {
    await deleteMutation.mutateAsync({ id, version: expectedVersion });
    if (orgId) await utils.user.listByOrg.invalidate({ orgId });
  };

  const onCreate = async () => {
    setCreateError(null);
    if (!orgId) {
      setCreateError('No organization available — cannot create user.');
      return;
    }
    try {
      await createMutation.mutateAsync({
        orgId,
        name: newName.trim(),
        email: newEmail.trim(),
        avatarUrl: newAvatarUrl.trim() || undefined,
      });
      setNewName('');
      setNewEmail('');
      setNewAvatarUrl('');
      setShowCreate(false);
      await utils.user.listByOrg.invalidate({ orgId });
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
        title="Users"
        description="Org-scoped users — name, email, optional avatar."
        action={
          orgId ? (
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all"
              onClick={() => setShowCreate((v) => !v)}
            >
              {showCreate ? 'Cancel' : 'New User'}
            </button>
          ) : undefined
        }
      />

      {showCreate && orgId ? (
        <Card padding="p-6">
          <h3 className="text-sm font-semibold text-white mb-3">New User</h3>
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
                aria-label="User name"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Email <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                aria-label="User email"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Avatar URL
              </label>
              <input
                type="url"
                aria-label="User avatar URL"
                placeholder="https://…"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newAvatarUrl}
                onChange={(e) => setNewAvatarUrl(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all disabled:opacity-50"
              disabled={
                !newName.trim() || !newEmail.trim() || createMutation.isPending
              }
              onClick={onCreate}
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </Card>
      ) : null}

      <RecordEditor<UserRecord>
        descriptor={userDescriptor}
        records={records}
        isLoading={listQuery.isLoading}
        onSave={onSave}
        onDelete={onDelete}
        onRefresh={async () => {
          if (orgId) await utils.user.listByOrg.invalidate({ orgId });
        }}
        canEdit={() => canEdit}
        canDelete={() => canDelete}
      />
    </div>
  );
}
