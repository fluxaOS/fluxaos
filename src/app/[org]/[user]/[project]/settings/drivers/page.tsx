// src/app/[org]/[user]/[project]/settings/drivers/page.tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/card';
import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { Feature, hasFeature } from '@/core/features/features';
import { useCurrentUser } from '@/lib/auth/use-current-user';
import { trpc } from '@/lib/trpc/client';
import { DriverRevisionHistory } from './DriverRevisionHistory';
import { type DriverRecord, driverDescriptor } from './descriptor';

export default function DriversSettingsPage() {
  const utils = trpc.useUtils();
  const listQuery = trpc.driver.list.useQuery();
  const updateMutation = trpc.driver.update.useMutation();
  const createMutation = trpc.driver.create.useMutation();
  const deleteMutation = trpc.driver.delete.useMutation();

  const records = (listQuery.data ?? []) as unknown as DriverRecord[];

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newBinary, setNewBinary] = useState('');
  // Operators paste/edit a JSON object. Driver schema requires this column
  // to be non-null (FLX-78). Default placeholder mirrors the seeded shape.
  const [newContextLayout, setNewContextLayout] = useState(
    '{\n  "instructionsFile": "CLAUDE.md",\n  "contextFile": "context.md"\n}'
  );
  const [createError, setCreateError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DriverRecord | null>(null);

  const onSave = async (
    id: string,
    patch: Partial<DriverRecord>,
    expectedVersion: number
  ) => {
    await updateMutation.mutateAsync({
      id,
      version: expectedVersion,
      ...(patch as Record<string, unknown>),
    });
    await utils.driver.list.invalidate();
    // FLX-91: edits create a new driver_revision row, refetch history.
    await utils.driver.listHistory.invalidate({ id });
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
    await utils.driver.list.invalidate();
    // FLX-91: toggling enabled creates a new driver_revision row.
    await utils.driver.listHistory.invalidate({ id });
  };

  const onDelete = async (id: string, expectedVersion: number) => {
    await deleteMutation.mutateAsync({ id, version: expectedVersion });
    await utils.driver.list.invalidate();
  };

  const onCreate = async () => {
    setCreateError(null);
    let contextLayout: unknown;
    try {
      contextLayout = JSON.parse(newContextLayout);
    } catch (err) {
      setCreateError(
        `Context layout must be valid JSON: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }
    try {
      await createMutation.mutateAsync({
        name: newName.trim(),
        slug: newSlug.trim(),
        binary: newBinary.trim(),
        contextLayout,
      });
      setNewName('');
      setNewSlug('');
      setNewBinary('');
      setShowCreate(false);
      await utils.driver.list.invalidate();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    }
  };

  const { userId } = useCurrentUser();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Drivers"
        description="Definitions for each AI CLI tool fluxaOS invokes (binary, flags, transport, env)."
        action={
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? 'Cancel' : 'New Driver'}
          </button>
        }
      />

      {showCreate ? (
        <Card padding="p-6">
          <h3 className="text-sm font-semibold text-white mb-3">New Driver</h3>
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
                aria-label="Driver name"
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
                aria-label="Driver slug"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Binary <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                aria-label="Driver binary"
                placeholder="claude"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newBinary}
                onChange={(e) => setNewBinary(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Context layout (JSON) <span className="text-red-400">*</span>
              </label>
              <textarea
                rows={5}
                aria-label="Driver context layout"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white font-mono"
                value={newContextLayout}
                onChange={(e) => setNewContextLayout(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all disabled:opacity-50"
              disabled={
                !newName.trim() ||
                !newSlug.trim() ||
                !newBinary.trim() ||
                createMutation.isPending
              }
              onClick={onCreate}
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </Card>
      ) : null}

      <RecordEditor<DriverRecord>
        descriptor={driverDescriptor}
        records={records}
        isLoading={listQuery.isLoading}
        onSave={onSave}
        onDelete={onDelete}
        onToggleEnabled={onToggleEnabled}
        onSelectionChange={setSelected}
        onRefresh={async () => {
          await utils.driver.list.invalidate();
        }}
        // DEF-002 role gates — today always true (see features.ts)
        canEdit={() => hasFeature(userId, Feature.ROLE_BASED_PERMISSIONS)}
        canDelete={() => hasFeature(userId, Feature.ROLE_BASED_PERMISSIONS)}
      />

      {selected ? <DriverRevisionHistory driver={selected} /> : null}
    </div>
  );
}
