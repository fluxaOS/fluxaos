// src/app/[org]/[user]/[project]/settings/users/page.tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/card';
import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { Feature, hasFeature } from '@/core/features/features';
import { useCurrentUser } from '@/lib/auth/use-current-user';
import { trpc } from '@/lib/trpc/client';
import { type UserRecord, userDescriptor } from './descriptor';

export default function UsersSettingsPage() {
  const utils = trpc.useUtils();
  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;

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
  const [newSlug, setNewSlug] = useState('');
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
        slug: newSlug.trim(),
        avatarUrl: newAvatarUrl.trim() || undefined,
      });
      setNewName('');
      setNewEmail('');
      setNewSlug('');
      setNewAvatarUrl('');
      setShowCreate(false);
      await utils.user.listByOrg.invalidate({ orgId });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  };

  const { userId } = useCurrentUser();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Users"
        description="Org-scoped users — name, email, kebab-case slug, optional avatar."
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
                Slug <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                aria-label="User slug"
                placeholder="kebab-case"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
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
                !newName.trim() ||
                !newEmail.trim() ||
                !newSlug.trim() ||
                createMutation.isPending
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
        canEdit={() => hasFeature(userId, Feature.ROLE_BASED_PERMISSIONS)}
        canDelete={() => hasFeature(userId, Feature.ROLE_BASED_PERMISSIONS)}
      />
    </div>
  );
}
