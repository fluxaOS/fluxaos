// src/app/[org]/[user]/[project]/settings/skills/page.tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/card';
import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { Feature } from '@/core/features/features';
import { useCanDelete, useCanEdit } from '@/lib/auth/use-viewer-role';
import { useHasFeature } from '@/lib/auth/use-viewer-tier';
import { trpc } from '@/lib/trpc/client';
import { type SkillRecord, skillDescriptor } from './descriptor';
import { SkillRevisionHistory } from './SkillRevisionHistory';

export default function SkillsSettingsPage() {
  const utils = trpc.useUtils();
  // Pass no projectId to list global skills (scope='global'). Project-scoped
  // skills are accessible via skill.listByProject when a projectId is known.
  const listQuery = trpc.skill.list.useQuery({});
  const updateMutation = trpc.skill.update.useMutation();
  const deleteMutation = trpc.skill.delete.useMutation();
  const createMutation = trpc.skill.create.useMutation();

  const records = (listQuery.data ?? []) as unknown as SkillRecord[];

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newScope, setNewScope] = useState<'global' | 'project'>('global');
  const [newDescription, setNewDescription] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [selected, setSelected] = useState<SkillRecord | null>(null);

  const onSave = async (
    id: string,
    patch: Partial<SkillRecord>,
    expectedVersion: number
  ) => {
    await updateMutation.mutateAsync({
      id,
      version: expectedVersion,
      ...(patch as Record<string, unknown>),
    });
    await utils.skill.list.invalidate();
    // FLX-13: edits create a new skill_revision row, so the history
    // panel must refetch.
    await utils.skill.listHistory.invalidate({ id });
  };

  const onDelete = async (id: string, expectedVersion: number) => {
    // Router enforces optimistic lock on delete as well — pass the version.
    await deleteMutation.mutateAsync({ id, version: expectedVersion });
    await utils.skill.list.invalidate();
  };

  const onCreate = async () => {
    await createMutation.mutateAsync({
      scope: newScope,
      name: newName,
      description: newDescription || undefined,
      promptTemplate: newPrompt || undefined,
    });
    setNewName('');
    setNewDescription('');
    setNewPrompt('');
    setShowCreate(false);
    await utils.skill.list.invalidate();
  };

  // FLX-12: role-based gating. Server-side enforcement via protectedMutation
  // is the actual security boundary; this disables buttons before the click.
  const canEdit = useCanEdit();
  const canDelete = useCanDelete();
  // FLX-14: revision history is a paid-tier feature.
  const hasRevisionHistory = useHasFeature(Feature.REVISION_HISTORY);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Skills"
        description="Job definitions (research, implement, review, etc.) with their prompt templates."
      />

      <div className="flex justify-end">
        <button
          type="button"
          className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? 'Cancel New Skill' : 'New Skill'}
        </button>
      </div>

      {showCreate ? (
        <Card padding="p-6">
          <h3 className="text-sm font-semibold text-white mb-3">New Skill</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                aria-label="Skill name"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Scope
              </label>
              <select
                aria-label="Skill scope"
                className="bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newScope}
                onChange={(e) =>
                  setNewScope(e.target.value as 'global' | 'project')
                }
              >
                <option value="global">global</option>
                <option value="project">project</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Description
              </label>
              <textarea
                rows={3}
                aria-label="Skill description"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1">
                Prompt template
              </label>
              <textarea
                rows={8}
                aria-label="Skill prompt template"
                className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white font-mono"
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all disabled:opacity-50"
              disabled={!newName.trim()}
              onClick={onCreate}
            >
              Create
            </button>
          </div>
        </Card>
      ) : null}

      <RecordEditor<SkillRecord>
        descriptor={skillDescriptor}
        records={records}
        isLoading={listQuery.isLoading}
        onSave={onSave}
        onDelete={onDelete}
        onSelectionChange={setSelected}
        onRefresh={async () => {
          await utils.skill.list.invalidate();
        }}
        canEdit={() => canEdit}
        canDelete={() => canDelete}
      />

      {selected && hasRevisionHistory ? (
        <SkillRevisionHistory skill={selected} />
      ) : null}
    </div>
  );
}
