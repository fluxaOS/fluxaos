'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { trpc } from '@/lib/trpc/client';

type Provider = {
  id: string;
  version: number;
  name: string;
  type: string;
  baseUrl: string | null;
  apiKeyRef: string | null;
  isHealthy: boolean;
};

export default function ProviderSettingsPage() {
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;

  const providersQuery = trpc.provider.list.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const providers = (providersQuery.data ?? []) as Provider[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Providers"
        action={
          orgId && (
            <button
              type="button"
              onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 bg-electric-violet hover:bg-accent-hover text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.3)]"
            >
              {showCreate ? 'Cancel' : 'New Provider'}
            </button>
          )
        }
      />

      {showCreate && orgId && (
        <CreateProviderForm
          orgId={orgId}
          onCreated={async () => {
            setShowCreate(false);
            await utils.provider.list.invalidate();
          }}
        />
      )}

      {providers.length === 0 ? (
        <EmptyState title="No providers configured" />
      ) : (
        <ul className="space-y-3">
          {providers.map((p) => (
            <li key={p.id} className="card-static p-4">
              {editingId === p.id ? (
                <EditProviderForm
                  provider={p}
                  onSaved={async () => {
                    setEditingId(null);
                    await utils.provider.list.invalidate();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-2 text-xs text-slate-400">
                        {p.type}
                      </span>
                      {p.isHealthy ? (
                        <span className="ml-2 text-xs text-green-400">
                          Healthy
                        </span>
                      ) : (
                        <span className="ml-2 text-xs text-red-400">
                          Unhealthy
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedId(expandedId === p.id ? null : p.id)
                        }
                        className="text-xs text-slate-400 hover:text-slate-300"
                      >
                        {expandedId === p.id ? 'Close' : 'Models'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(p.id)}
                        className="text-xs text-slate-400 hover:text-slate-300"
                      >
                        Edit
                      </button>
                      <DeleteProviderButton
                        providerId={p.id}
                        providerVersion={p.version}
                        onDeleted={() => utils.provider.list.invalidate()}
                      />
                    </div>
                  </div>
                  {p.baseUrl && (
                    <p className="text-xs text-slate-400 mt-0.5">{p.baseUrl}</p>
                  )}
                </>
              )}

              {editingId !== p.id && expandedId === p.id && (
                <ModelsEditor providerId={p.id} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateProviderForm({
  orgId,
  onCreated,
}: {
  orgId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKeyRef, setApiKeyRef] = useState('');

  const createMutation = trpc.provider.create.useMutation({
    onSuccess: () => onCreated(),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !type.trim()) return;
        createMutation.mutate({
          orgId,
          name: name.trim(),
          type: type.trim(),
          baseUrl: baseUrl.trim() || undefined,
          apiKeyRef: apiKeyRef.trim() || undefined,
        });
      }}
      className="card-static p-4 space-y-3"
    >
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="text-xs text-slate-400">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Provider name"
            className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
        <label className="flex-1">
          <span className="text-xs text-slate-400">Type</span>
          <input
            type="text"
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="provider slug"
            aria-label="Provider type"
            className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
      </div>
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="text-xs text-slate-400">Base URL (optional)</span>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            aria-label="Provider base URL"
            className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
        <label className="flex-1">
          <span className="text-xs text-slate-400">
            API Key Reference (optional)
          </span>
          <input
            type="text"
            value={apiKeyRef}
            onChange={(e) => setApiKeyRef(e.target.value)}
            placeholder="env:API_KEY_NAME"
            aria-label="Provider API key reference"
            className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={!name.trim() || !type.trim() || createMutation.isPending}
        className="px-4 py-1.5 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
      >
        {createMutation.isPending ? 'Creating…' : 'Create'}
      </button>
    </form>
  );
}

function EditProviderForm({
  provider,
  onSaved,
  onCancel,
}: {
  provider: Provider;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(provider.name);
  const [type, setType] = useState(provider.type);
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '');
  const [apiKeyRef, setApiKeyRef] = useState(provider.apiKeyRef ?? '');

  const updateMutation = trpc.provider.update.useMutation({
    onSuccess: () => onSaved(),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !type.trim()) return;
        updateMutation.mutate({
          id: provider.id,
          version: provider.version,
          name: name.trim(),
          type: type.trim(),
          baseUrl: baseUrl.trim() || undefined,
          apiKeyRef: apiKeyRef.trim() || undefined,
        });
      }}
      className="space-y-3"
    >
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="text-xs text-slate-400">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Provider name"
            className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
        <label className="flex-1">
          <span className="text-xs text-slate-400">Type</span>
          <input
            type="text"
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Provider type"
            className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
      </div>
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="text-xs text-slate-400">Base URL</span>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            aria-label="Provider base URL"
            className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
        <label className="flex-1">
          <span className="text-xs text-slate-400">API Key Reference</span>
          <input
            type="text"
            value={apiKeyRef}
            onChange={(e) => setApiKeyRef(e.target.value)}
            aria-label="Provider API key reference"
            className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!name.trim() || !type.trim() || updateMutation.isPending}
          className="px-3 py-1.5 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-slate-400 text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function DeleteProviderButton({
  providerId,
  providerVersion,
  onDeleted,
}: {
  providerId: string;
  providerVersion: number;
  onDeleted: () => void;
}) {
  const deleteMutation = trpc.provider.delete.useMutation({
    onSuccess: () => onDeleted(),
  });

  return (
    <button
      type="button"
      onClick={() => {
        if (confirm('Delete this provider?')) {
          deleteMutation.mutate({ id: providerId, version: providerVersion });
        }
      }}
      disabled={deleteMutation.isPending}
      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
    >
      {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
    </button>
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
    <div className="mt-3 pt-3 border-t border-slate-700/20 space-y-2">
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
  );
}
