'use client';

import { useState } from 'react';
import { Card } from '@/components/card';
import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { useCanDelete, useCanEdit } from '@/lib/auth/use-viewer-role';
import { trpc } from '@/lib/trpc/client';
import {
  type RoutingProfileRecord,
  routingProfileDescriptor,
} from './descriptor';

export default function RoutingSettingsPage() {
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [selected, setSelected] = useState<RoutingProfileRecord | null>(null);

  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;

  const profilesQuery = trpc.routing.listProfiles.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const records = (profilesQuery.data ??
    []) as unknown as RoutingProfileRecord[];

  const updateMutation = trpc.routing.updateProfile.useMutation();
  const deleteMutation = trpc.routing.deleteProfile.useMutation();
  const createMutation = trpc.routing.createProfile.useMutation();

  const canEdit = useCanEdit();
  const canDelete = useCanDelete();

  const onSave = async (
    id: string,
    patch: Partial<RoutingProfileRecord>,
    expectedVersion: number
  ) => {
    await updateMutation.mutateAsync({
      id,
      version: expectedVersion,
      ...(patch as Record<string, unknown>),
    });
    await utils.routing.listProfiles.invalidate();
  };

  const onDelete = async (id: string, expectedVersion: number) => {
    await deleteMutation.mutateAsync({ id, version: expectedVersion });
    await utils.routing.listProfiles.invalidate();
    if (selected?.id === id) setSelected(null);
  };

  const onCreate = async () => {
    if (!newName.trim() || !orgId) return;
    await createMutation.mutateAsync({
      orgId,
      name: newName.trim(),
      description: newDescription.trim() || undefined,
    });
    setNewName('');
    setNewDescription('');
    setShowCreate(false);
    await utils.routing.listProfiles.invalidate();
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Routing Profiles" />

      {orgId ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? 'Cancel New Profile' : 'New Profile'}
          </button>
        </div>
      ) : null}

      {showCreate ? (
        <Card padding="p-6">
          <h3 className="text-sm font-semibold text-white mb-3">
            New Routing Profile
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                aria-label="Profile name"
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
                aria-label="Profile description"
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

      <RecordEditor<RoutingProfileRecord>
        descriptor={routingProfileDescriptor}
        records={records}
        isLoading={profilesQuery.isLoading}
        onSave={onSave}
        onDelete={onDelete}
        onSelectionChange={setSelected}
        onRefresh={async () => {
          await utils.routing.listProfiles.invalidate();
        }}
        canEdit={() => canEdit}
        canDelete={() => canDelete}
      />

      {selected ? <RulesEditor profileId={selected.id} /> : null}
    </div>
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
  const [driver, setDriver] = useState('');
  const [sortStrategy, setSortStrategy] = useState('quality');

  return (
    <Card padding="p-4">
      <h3 className="text-xs font-semibold text-slate-400 mb-3">Rules</h3>
      <div className="space-y-2">
        {rules.length === 0 ? (
          <p className="text-xs text-slate-500">No rules configured.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 text-left">
                <th className="pr-3 py-1 font-medium">Stage</th>
                <th className="pr-3 py-1 font-medium">Models</th>
                <th className="pr-3 py-1 font-medium">Driver</th>
                <th className="pr-3 py-1 font-medium">Sort</th>
                <th className="pr-3 py-1 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className="text-slate-300">
                  <td className="pr-3 py-1">{r.stageName ?? '*'}</td>
                  <td className="pr-3 py-1">{r.allowedModelsPattern ?? '*'}</td>
                  <td className="pr-3 py-1">{r.preferredDriver ?? '-'}</td>
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
                preferredDriver: driver.trim() || undefined,
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
              className="bg-slate-900 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-foreground w-24"
            />
            <input
              type="text"
              value={modelsPattern}
              onChange={(e) => setModelsPattern(e.target.value)}
              placeholder="Models pattern"
              className="bg-slate-900 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-foreground w-32"
            />
            <input
              type="text"
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              placeholder="Driver"
              className="bg-slate-900 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-foreground w-24"
            />
            <select
              value={sortStrategy}
              onChange={(e) => setSortStrategy(e.target.value)}
              className="bg-slate-900 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-foreground"
            >
              <option value="quality">quality</option>
              <option value="cost">cost</option>
              <option value="speed">speed</option>
            </select>
            <button
              type="submit"
              disabled={createRule.isPending}
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
            + Add Rule
          </button>
        )}
      </div>
    </Card>
  );
}
