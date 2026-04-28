// src/app/[org]/[user]/[project]/settings/system/page.tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/card';
import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { useCanDelete, useCanEdit } from '@/lib/auth/use-viewer-role';
import { trpc } from '@/lib/trpc/client';
import { type ConfigEntryRecord, configEntryDescriptor } from './descriptor';

export default function SystemSettingsPage() {
  const utils = trpc.useUtils();
  const listQuery = trpc.config.list.useQuery();
  const updateMutation = trpc.config.update.useMutation();
  const createMutation = trpc.config.create.useMutation();
  const deleteMutation = trpc.config.delete.useMutation();

  const records = (listQuery.data ?? []) as unknown as ConfigEntryRecord[];

  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newScope, setNewScope] = useState('global');
  const [newValue, setNewValue] = useState('{\n  \n}');
  const [createError, setCreateError] = useState<string | null>(null);

  const onSave = async (
    id: string,
    patch: Partial<ConfigEntryRecord>,
    expectedVersion: number
  ) => {
    // RecordEditor sends back fields including readonly previousValue and
    // version — strip those server-side via Zod (they're not in the
    // update input schema), but be explicit here for clarity.
    const { previousValue: _prev, ...allowed } =
      patch as Partial<ConfigEntryRecord> & { previousValue?: unknown };
    void _prev;
    await updateMutation.mutateAsync({
      id,
      version: expectedVersion,
      ...(allowed as Record<string, unknown>),
    });
    await utils.config.list.invalidate();
  };

  const onDelete = async (id: string, expectedVersion: number) => {
    await deleteMutation.mutateAsync({ id, version: expectedVersion });
    await utils.config.list.invalidate();
  };

  const onCreate = async () => {
    setCreateError(null);
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(newValue);
    } catch (err) {
      setCreateError(
        `Value must be valid JSON: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }
    try {
      await createMutation.mutateAsync({
        scope: newScope.trim(),
        key: newKey.trim(),
        value: parsedValue,
      });
      setNewKey('');
      setNewScope('global');
      setNewValue('{\n  \n}');
      setShowCreate(false);
      await utils.config.list.invalidate();
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
        title="System"
        description="Project and global config entries (`config_entry`)."
        action={
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? 'Cancel' : 'New Config Entry'}
          </button>
        }
      />

      {showCreate ? (
        <Card padding="p-6">
          <h3 className="text-sm font-semibold text-white mb-3">
            New Config Entry
          </h3>
          {createError ? (
            <div className="mb-3 px-3 py-2 rounded-lg text-sm bg-red-600/10 text-red-300 border border-red-600/30">
              {createError}
            </div>
          ) : null}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Key <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                aria-label="Config entry key"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Scope <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                aria-label="Config entry scope"
                placeholder="global | project | user"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newScope}
                onChange={(e) => setNewScope(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Value (JSON) <span className="text-red-400">*</span>
              </label>
              <textarea
                rows={5}
                aria-label="Config entry value"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white font-mono"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all disabled:opacity-50"
              disabled={
                !newKey.trim() || !newScope.trim() || createMutation.isPending
              }
              onClick={onCreate}
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </Card>
      ) : null}

      <RecordEditor<ConfigEntryRecord>
        descriptor={configEntryDescriptor}
        records={records}
        isLoading={listQuery.isLoading}
        onSave={onSave}
        onDelete={onDelete}
        onRefresh={async () => {
          await utils.config.list.invalidate();
        }}
        canEdit={() => canEdit}
        canDelete={() => canDelete}
      />
    </div>
  );
}
