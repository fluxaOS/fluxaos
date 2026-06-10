// src/app/[org]/[user]/[project]/settings/skills/page.tsx
'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { CreateEntityForm } from '@/components/record-editor/CreateEntityForm';
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

  // FLX-239: skill rows carry `kind` (waterfall discriminator); the UI keeps
  // the scope alias — 'global' for catalog rows, 'project' otherwise — so the
  // list subtitle and the create form's Scope select speak the same language.
  const records = (listQuery.data ?? []).map((row) => ({
    ...row,
    scope: row.kind === 'catalog' ? 'global' : 'project',
  })) as unknown as SkillRecord[];

  const [showCreate, setShowCreate] = useState(false);
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
        <CreateEntityForm
          title="New Skill"
          fields={[
            { key: 'name', label: 'Name', required: true },
            {
              key: 'scope',
              label: 'Scope',
              type: 'select',
              defaultValue: 'global',
              options: [
                { value: 'global', label: 'global' },
                { value: 'project', label: 'project' },
              ],
            },
            { key: 'description', label: 'Description', type: 'textarea' },
            {
              key: 'promptTemplate',
              label: 'Prompt template',
              type: 'textarea',
              rows: 8,
              mono: true,
            },
          ]}
          onSubmit={async (vals) => {
            await createMutation.mutateAsync({
              scope: vals.scope as 'global' | 'project',
              name: vals.name,
              description: vals.description || undefined,
              promptTemplate: vals.promptTemplate || undefined,
            });
            setShowCreate(false);
            await utils.skill.list.invalidate();
          }}
          onCancel={() => setShowCreate(false)}
        />
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
