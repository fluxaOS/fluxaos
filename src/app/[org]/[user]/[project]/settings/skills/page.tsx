// src/app/[org]/[user]/[project]/settings/skills/page.tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/card';
import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { Feature, hasFeature } from '@/core/features/features';
import { useCurrentUser } from '@/lib/auth/use-current-user';
import { trpc } from '@/lib/trpc/client';
import { type SkillRecord, skillDescriptor } from './descriptor';

export default function SkillsSettingsPage() {
  const utils = trpc.useUtils();
  const listQuery = trpc.skill.list.useQuery();
  const updateMutation = trpc.skill.update.useMutation();
  const deleteMutation = trpc.skill.delete.useMutation();
  const createMutation = trpc.skill.create.useMutation();

  const records = (listQuery.data ?? []) as unknown as SkillRecord[];

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newScope, setNewScope] = useState<'global' | 'project'>('global');
  const [newDescription, setNewDescription] = useState('');
  const [newPrompt, setNewPrompt] = useState('');

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

  const { userId } = useCurrentUser();

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
        onRefresh={async () => {
          await utils.skill.list.invalidate();
        }}
        // DEF-002 role gates — today always true (see features.ts)
        canEdit={() => hasFeature(userId, Feature.ROLE_BASED_PERMISSIONS)}
        canDelete={() => hasFeature(userId, Feature.ROLE_BASED_PERMISSIONS)}
      />
    </div>
  );
}
