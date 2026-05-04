'use client';

import { useState } from 'react';
import { Card } from '@/components/card';
import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { useCanDelete, useCanEdit } from '@/lib/auth/use-viewer-role';
import { trpc } from '@/lib/trpc/client';
import { type ProviderRecord, providerDescriptor } from './descriptor';

export default function ProviderSettingsPage() {
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [newApiKeyRef, setNewApiKeyRef] = useState('');
  const [selected, setSelected] = useState<ProviderRecord | null>(null);

  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;

  const providersQuery = trpc.provider.list.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const records = (providersQuery.data ?? []) as unknown as ProviderRecord[];

  const updateMutation = trpc.provider.update.useMutation();
  const deleteMutation = trpc.provider.delete.useMutation();
  const createMutation = trpc.provider.create.useMutation();

  const canEdit = useCanEdit();
  const canDelete = useCanDelete();

  const onSave = async (
    id: string,
    patch: Partial<ProviderRecord>,
    expectedVersion: number
  ) => {
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== null)
    );
    await updateMutation.mutateAsync({
      id,
      version: expectedVersion,
      ...clean,
    });
    await utils.provider.list.invalidate();
  };

  const onDelete = async (id: string, expectedVersion: number) => {
    await deleteMutation.mutateAsync({ id, version: expectedVersion });
    await utils.provider.list.invalidate();
    if (selected?.id === id) setSelected(null);
  };

  const onCreate = async () => {
    if (!newName.trim() || !newType.trim() || !orgId) return;
    await createMutation.mutateAsync({
      orgId,
      name: newName.trim(),
      type: newType.trim(),
      baseUrl: newBaseUrl.trim() || undefined,
      apiKeyRef: newApiKeyRef.trim() || undefined,
    });
    setNewName('');
    setNewType('');
    setNewBaseUrl('');
    setNewApiKeyRef('');
    setShowCreate(false);
    await utils.provider.list.invalidate();
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Providers" />

      {orgId ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? 'Cancel New Provider' : 'New Provider'}
          </button>
        </div>
      ) : null}

      {showCreate ? (
        <Card padding="p-6">
          <h3 className="text-sm font-semibold text-white mb-3">
            New Provider
          </h3>
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  aria-label="Provider name"
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">
                  Type <span className="text-red-400">*</span>
                </label>
                <input
                  aria-label="Provider type"
                  placeholder="provider slug"
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">
                  Base URL (optional)
                </label>
                <input
                  aria-label="Provider base URL"
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                  value={newBaseUrl}
                  onChange={(e) => setNewBaseUrl(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">
                  API Key Reference (optional)
                </label>
                <input
                  aria-label="Provider API key reference"
                  placeholder="env:API_KEY_NAME"
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                  value={newApiKeyRef}
                  onChange={(e) => setNewApiKeyRef(e.target.value)}
                />
              </div>
            </div>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all disabled:opacity-50"
              disabled={
                !newName.trim() || !newType.trim() || createMutation.isPending
              }
              onClick={onCreate}
            >
              Create
            </button>
          </div>
        </Card>
      ) : null}

      <RecordEditor<ProviderRecord>
        descriptor={providerDescriptor}
        records={records}
        isLoading={providersQuery.isLoading}
        onSave={onSave}
        onDelete={onDelete}
        onSelectionChange={setSelected}
        onRefresh={async () => {
          await utils.provider.list.invalidate();
        }}
        canEdit={() => canEdit}
        canDelete={() => canDelete}
      />

      {selected ? <ModelsEditor providerId={selected.id} /> : null}
    </div>
  );
}

function ModelsEditor({ providerId }: { providerId: string }) {
  const [showAdd, setShowAdd] = useState(false);
  const modelsQuery = trpc.provider.listModels.useQuery({ providerId });
  const models = modelsQuery.data ?? [];

  const createModel = trpc.provider.createModel.useMutation({
    onSuccess: () => {
      setShowAdd(false);
      modelsQuery.refetch();
    },
  });

  const deleteModel = trpc.provider.deleteModel.useMutation({
    onSuccess: () => modelsQuery.refetch(),
  });

  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');

  return (
    <Card padding="p-4">
      <h3 className="text-xs font-semibold text-slate-400 mb-3">Models</h3>
      <div className="space-y-2">
        {models.length === 0 ? (
          <p className="text-xs text-slate-500">No models configured.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 text-left">
                <th className="pr-3 py-1 font-medium">Name</th>
                <th className="pr-3 py-1 font-medium">Identifier</th>
                <th className="pr-3 py-1 font-medium">Cost (in/out)</th>
                <th className="pr-3 py-1 font-medium" />
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id} className="text-slate-300">
                  <td className="pr-3 py-1">{m.name}</td>
                  <td className="pr-3 py-1 font-mono">{m.identifier}</td>
                  <td className="pr-3 py-1">
                    ${m.costPer1kInput ?? '0'} / ${m.costPer1kOutput ?? '0'}
                  </td>
                  <td className="pr-3 py-1">
                    <button
                      type="button"
                      onClick={() => deleteModel.mutate({ id: m.id })}
                      className="text-red-400 hover:text-red-300 text-xs"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {showAdd ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim() || !identifier.trim()) return;
              createModel.mutate({
                providerId,
                name: name.trim(),
                identifier: identifier.trim(),
              });
            }}
            className="flex gap-2 items-end"
          >
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Model name"
              className="bg-slate-900 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-foreground"
            />
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="model identifier"
              className="bg-slate-900 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-foreground"
            />
            <button
              type="submit"
              disabled={createModel.isPending}
              className="px-2 py-1 bg-electric-violet text-white text-xs rounded-md disabled:opacity-50"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="px-2 py-1 text-slate-400 text-xs"
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="text-xs text-soft-violet hover:text-electric-violet"
          >
            + Add Model
          </button>
        )}
      </div>
    </Card>
  );
}
