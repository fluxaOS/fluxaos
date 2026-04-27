'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { trpc } from '@/lib/trpc/client';

export default function TeamsSettingsPage() {
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const projectsQuery = trpc.project.listByOrg.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const projectId = projectsQuery.data?.[0]?.id;

  const teamsQuery = trpc.team.listByProject.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const teams = teamsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teams"
        action={
          projectId ? (
            <button
              type="button"
              onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 bg-electric-violet hover:bg-accent-hover text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.3)]"
            >
              {showCreate ? 'Cancel' : 'New Team'}
            </button>
          ) : undefined
        }
      />

      {showCreate && projectId && (
        <CreateTeamForm
          projectId={projectId}
          onCreated={async () => {
            setShowCreate(false);
            await utils.team.listByProject.invalidate();
          }}
        />
      )}

      {teams.length === 0 ? (
        <EmptyState title="No teams configured" />
      ) : (
        <ul className="space-y-3">
          {teams.map((t) => (
            <li key={t.id} className="card-static p-4">
              {editingId === t.id ? (
                <EditTeamForm
                  team={t}
                  onSaved={async () => {
                    setEditingId(null);
                    await utils.team.listByProject.invalidate();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{t.name}</span>
                    {t.description && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        {t.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setEditingId(t.id)}
                      className="text-xs text-slate-400 hover:text-slate-300"
                    >
                      Edit
                    </button>
                    <DeleteTeamButton
                      teamId={t.id}
                      onDeleted={() => utils.team.listByProject.invalidate()}
                    />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateTeamForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const createMutation = trpc.team.create.useMutation({
    onSuccess: () => onCreated(),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        createMutation.mutate({
          projectId,
          name: name.trim(),
          description: description.trim() || undefined,
        });
      }}
      className="card-static p-4 flex gap-3 items-end"
    >
      <label className="flex-1">
        <span className="text-xs text-slate-400">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Team name"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
        />
      </label>
      <label className="flex-1">
        <span className="text-xs text-slate-400">Description</span>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Team description"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
        />
      </label>
      <button
        type="submit"
        disabled={!name.trim() || createMutation.isPending}
        className="px-4 py-1.5 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
      >
        {createMutation.isPending ? 'Creating…' : 'Create'}
      </button>
    </form>
  );
}

function EditTeamForm({
  team,
  onSaved,
  onCancel,
}: {
  team: { id: string; name: string; description: string | null };
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(team.name);
  const [description, setDescription] = useState(team.description ?? '');

  const updateMutation = trpc.team.update.useMutation({
    onSuccess: () => onSaved(),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        updateMutation.mutate({
          id: team.id,
          name: name.trim(),
          description: description.trim() || null,
        });
      }}
      className="flex gap-3 items-end"
    >
      <label className="flex-1">
        <span className="text-xs text-slate-400">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Team name"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
        />
      </label>
      <label className="flex-1">
        <span className="text-xs text-slate-400">Description</span>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Team description"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
        />
      </label>
      <button
        type="submit"
        disabled={!name.trim() || updateMutation.isPending}
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
    </form>
  );
}

function DeleteTeamButton({
  teamId,
  onDeleted,
}: {
  teamId: string;
  onDeleted: () => void;
}) {
  const deleteMutation = trpc.team.delete.useMutation({
    onSuccess: () => onDeleted(),
  });

  return (
    <button
      type="button"
      onClick={() => {
        if (confirm('Delete this team?')) {
          deleteMutation.mutate({ id: teamId });
        }
      }}
      disabled={deleteMutation.isPending}
      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
    >
      {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
    </button>
  );
}
