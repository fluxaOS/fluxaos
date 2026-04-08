'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { trpc } from '@/lib/trpc/client';

export default function RoutingSettingsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;

  const profilesQuery = trpc.routing.listProfiles.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const profiles = profilesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Routing Profiles</h2>
        {orgId && (
          <button
            type="button"
            onClick={() => setShowCreate(!showCreate)}
            className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
          >
            {showCreate ? 'Cancel' : 'New Profile'}
          </button>
        )}
      </div>

      {showCreate && orgId && (
        <CreateProfileForm
          orgId={orgId}
          onCreated={() => {
            setShowCreate(false);
            profilesQuery.refetch();
          }}
        />
      )}

      {profiles.length === 0 ? (
        <EmptyState title="No routing profiles configured" />
      ) : (
        <div className="space-y-3">
          {profiles.map((p) => (
            <div
              key={p.id}
              className="bg-sidebar border border-sidebar-border rounded-lg p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{p.name}</span>
                  {p.isDefault && (
                    <span className="ml-2 text-xs text-accent">default</span>
                  )}
                  {p.description && (
                    <p className="text-xs text-muted mt-0.5">{p.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId(expandedId === p.id ? null : p.id)
                  }
                  className="text-xs text-muted hover:text-foreground"
                >
                  {expandedId === p.id ? 'Close' : 'Rules'}
                </button>
              </div>

              {expandedId === p.id && <RulesEditor profileId={p.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateProfileForm({
  orgId,
  onCreated,
}: {
  orgId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const createMutation = trpc.routing.createProfile.useMutation({
    onSuccess: () => onCreated(),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        createMutation.mutate({
          orgId,
          name: name.trim(),
          description: description.trim() || undefined,
        });
      }}
      className="bg-sidebar border border-sidebar-border rounded-lg p-4 flex gap-3 items-end"
    >
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
        <span className="text-xs text-muted">Description</span>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-background border border-sidebar-border rounded-md px-3 py-1.5 text-sm text-foreground mt-1"
        />
      </label>
      <button
        type="submit"
        disabled={!name.trim() || createMutation.isPending}
        className="px-4 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
      >
        Create
      </button>
    </form>
  );
}

function RulesEditor({ profileId }: { profileId: string }) {
  const [showAdd, setShowAdd] = useState(false);
  const rulesQuery = trpc.routing.listRules.useQuery({ profileId });
  const rules = rulesQuery.data ?? [];

  const createRule = trpc.routing.createRule.useMutation({
    onSuccess: () => {
      setShowAdd(false);
      rulesQuery.refetch();
    },
  });

  const deleteRule = trpc.routing.deleteRule.useMutation({
    onSuccess: () => rulesQuery.refetch(),
  });

  const [stageName, setStageName] = useState('');
  const [modelsPattern, setModelsPattern] = useState('');
  const [harness, setHarness] = useState('');
  const [sortStrategy, setSortStrategy] = useState('quality');

  return (
    <div className="mt-3 pt-3 border-t border-sidebar-border space-y-2">
      {rules.length === 0 ? (
        <p className="text-xs text-muted">No rules configured.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted text-left">
              <th className="pr-3 py-1 font-medium">Stage</th>
              <th className="pr-3 py-1 font-medium">Models</th>
              <th className="pr-3 py-1 font-medium">Harness</th>
              <th className="pr-3 py-1 font-medium">Sort</th>
              <th className="pr-3 py-1 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="text-foreground/80">
                <td className="pr-3 py-1">{r.stageName ?? '*'}</td>
                <td className="pr-3 py-1">{r.allowedModelsPattern ?? '*'}</td>
                <td className="pr-3 py-1">{r.preferredHarness ?? '-'}</td>
                <td className="pr-3 py-1">{r.sortStrategy}</td>
                <td className="pr-3 py-1">
                  <button
                    type="button"
                    onClick={() => deleteRule.mutate({ id: r.id })}
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
            createRule.mutate({
              profileId,
              stageName: stageName.trim() || undefined,
              allowedModelsPattern: modelsPattern.trim() || undefined,
              preferredHarness: harness.trim() || undefined,
              sortStrategy,
            });
          }}
          className="flex gap-2 items-end flex-wrap"
        >
          <input
            type="text"
            value={stageName}
            onChange={(e) => setStageName(e.target.value)}
            placeholder="Stage name"
            className="bg-background border border-sidebar-border rounded-md px-2 py-1 text-xs text-foreground w-24"
          />
          <input
            type="text"
            value={modelsPattern}
            onChange={(e) => setModelsPattern(e.target.value)}
            placeholder="Models pattern"
            className="bg-background border border-sidebar-border rounded-md px-2 py-1 text-xs text-foreground w-32"
          />
          <input
            type="text"
            value={harness}
            onChange={(e) => setHarness(e.target.value)}
            placeholder="Harness"
            className="bg-background border border-sidebar-border rounded-md px-2 py-1 text-xs text-foreground w-24"
          />
          <select
            value={sortStrategy}
            onChange={(e) => setSortStrategy(e.target.value)}
            className="bg-background border border-sidebar-border rounded-md px-2 py-1 text-xs text-foreground"
          >
            <option value="quality">quality</option>
            <option value="cost">cost</option>
            <option value="speed">speed</option>
          </select>
          <button
            type="submit"
            disabled={createRule.isPending}
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
          + Add Rule
        </button>
      )}
    </div>
  );
}
