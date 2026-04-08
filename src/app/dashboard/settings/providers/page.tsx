'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { trpc } from '@/lib/trpc/client';

export default function ProviderSettingsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;

  const providersQuery = trpc.provider.list.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const providers = providersQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Providers</h2>
        {orgId && (
          <button
            type="button"
            onClick={() => setShowCreate(!showCreate)}
            className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
          >
            {showCreate ? 'Cancel' : 'New Provider'}
          </button>
        )}
      </div>

      {showCreate && orgId && (
        <CreateProviderForm
          orgId={orgId}
          onCreated={() => {
            setShowCreate(false);
            providersQuery.refetch();
          }}
        />
      )}

      {providers.length === 0 ? (
        <EmptyState title="No providers configured" />
      ) : (
        <div className="space-y-3">
          {providers.map((p) => (
            <div
              key={p.id}
              className="bg-sidebar border border-sidebar-border rounded-lg p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-xs text-muted">{p.type}</span>
                  {p.isHealthy ? (
                    <span className="ml-2 text-xs text-green-400">healthy</span>
                  ) : (
                    <span className="ml-2 text-xs text-red-400">unhealthy</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId(expandedId === p.id ? null : p.id)
                  }
                  className="text-xs text-muted hover:text-foreground"
                >
                  {expandedId === p.id ? 'Close' : 'Models'}
                </button>
              </div>
              {p.baseUrl && (
                <p className="text-xs text-muted mt-0.5">{p.baseUrl}</p>
              )}

              {expandedId === p.id && <ModelsEditor providerId={p.id} />}
            </div>
          ))}
        </div>
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
      className="bg-sidebar border border-sidebar-border rounded-lg p-4 space-y-3"
    >
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="text-xs text-muted">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-background border border-sidebar-border rounded-md px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
        <label className="flex-1">
          <span className="text-xs text-muted">Type</span>
          <input
            type="text"
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="anthropic, openai, etc."
            className="w-full bg-background border border-sidebar-border rounded-md px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
      </div>
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="text-xs text-muted">Base URL (optional)</span>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="w-full bg-background border border-sidebar-border rounded-md px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
        <label className="flex-1">
          <span className="text-xs text-muted">
            API Key Reference (optional)
          </span>
          <input
            type="text"
            value={apiKeyRef}
            onChange={(e) => setApiKeyRef(e.target.value)}
            placeholder="env:ANTHROPIC_API_KEY"
            className="w-full bg-background border border-sidebar-border rounded-md px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={!name.trim() || !type.trim() || createMutation.isPending}
        className="px-4 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
      >
        {createMutation.isPending ? 'Creating...' : 'Create'}
      </button>
    </form>
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
    <div className="mt-3 pt-3 border-t border-sidebar-border space-y-2">
      {models.length === 0 ? (
        <p className="text-xs text-muted">No models configured.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted text-left">
              <th className="pr-3 py-1 font-medium">Name</th>
              <th className="pr-3 py-1 font-medium">Identifier</th>
              <th className="pr-3 py-1 font-medium">Cost (in/out)</th>
              <th className="pr-3 py-1 font-medium" />
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id} className="text-foreground/80">
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
            className="bg-background border border-sidebar-border rounded-md px-2 py-1 text-xs text-foreground"
          />
          <input
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="claude-sonnet-4-6"
            className="bg-background border border-sidebar-border rounded-md px-2 py-1 text-xs text-foreground"
          />
          <button
            type="submit"
            disabled={createModel.isPending}
            className="px-2 py-1 bg-accent text-white text-xs rounded-md disabled:opacity-50"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setShowAdd(false)}
            className="px-2 py-1 text-muted text-xs"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="text-xs text-accent hover:text-accent-hover"
        >
          + Add Model
        </button>
      )}
    </div>
  );
}
