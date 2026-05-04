'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Card } from '@/components/card';
import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { useCanDelete, useCanEdit } from '@/lib/auth/use-viewer-role';
import { trpc } from '@/lib/trpc/client';
import { type BrandRecord, brandDescriptor } from './descriptor';

export default function BrandSettingsPage() {
  const params = useParams<{ project: string }>();
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newScope, setNewScope] = useState<'org' | 'project'>('org');
  const [newTone, setNewTone] = useState('');
  const [newStyleGuide, setNewStyleGuide] = useState('');

  const projectSlug = params.project ?? 'fluxaos';
  const currentProjectQuery = trpc.project.getBySlug.useQuery({
    slug: projectSlug,
  });
  const currentProject = currentProjectQuery.data ?? null;
  const projectId = currentProject?.id ?? null;
  const orgId = currentProject?.orgId ?? null;

  const brandsQuery = trpc.brand.listVisibleToProject.useQuery(
    { orgId: orgId!, projectId: projectId! },
    { enabled: !!orgId && !!projectId }
  );
  const records = (brandsQuery.data ?? []) as unknown as BrandRecord[];

  const updateMutation = trpc.brand.update.useMutation();
  const deleteMutation = trpc.brand.delete.useMutation();
  const createMutation = trpc.brand.create.useMutation();

  const canEdit = useCanEdit();
  const canDelete = useCanDelete();

  const onSave = async (
    id: string,
    patch: Partial<BrandRecord>,
    expectedVersion: number
  ) => {
    await updateMutation.mutateAsync({
      id,
      version: expectedVersion,
      ...(patch as Record<string, unknown>),
    });
    await utils.brand.listVisibleToProject.invalidate();
  };

  const onDelete = async (id: string, expectedVersion: number) => {
    await deleteMutation.mutateAsync({ id, version: expectedVersion });
    await utils.brand.listVisibleToProject.invalidate();
  };

  const onCreate = async () => {
    if (!newName.trim() || !orgId || !projectId) return;
    await createMutation.mutateAsync({
      orgId,
      projectId: newScope === 'project' ? projectId : null,
      name: newName.trim(),
      toneOfVoice: newTone.trim() || null,
      styleGuide: newStyleGuide.trim() || null,
    });
    setNewName('');
    setNewScope('org');
    setNewTone('');
    setNewStyleGuide('');
    setShowCreate(false);
    await utils.brand.listVisibleToProject.invalidate();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Brands"
        description="Manage runtime brand context for agent output."
      />

      {orgId && projectId ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-medium bg-electric-violet text-white hover:bg-accent-hover transition-all"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? 'Cancel New Brand' : 'New Brand'}
          </button>
        </div>
      ) : null}

      {showCreate ? (
        <Card padding="p-6">
          <h3 className="text-sm font-semibold text-white mb-3">New Brand</h3>
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  aria-label="Brand name"
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
                  aria-label="Brand scope"
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white"
                  value={newScope}
                  onChange={(e) =>
                    setNewScope(e.target.value as 'org' | 'project')
                  }
                >
                  <option value="org">organization</option>
                  <option value="project">project</option>
                </select>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">
                  Tone of voice
                </label>
                <textarea
                  aria-label="Tone of voice"
                  rows={3}
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white resize-none"
                  value={newTone}
                  onChange={(e) => setNewTone(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">
                  Style guide
                </label>
                <textarea
                  aria-label="Style guide"
                  rows={3}
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-white resize-none"
                  value={newStyleGuide}
                  onChange={(e) => setNewStyleGuide(e.target.value)}
                />
              </div>
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

      <RecordEditor<BrandRecord>
        descriptor={brandDescriptor}
        records={records}
        isLoading={brandsQuery.isLoading}
        onSave={onSave}
        onDelete={onDelete}
        onRefresh={async () => {
          await utils.brand.listVisibleToProject.invalidate();
        }}
        canEdit={() => canEdit}
        canDelete={() => canDelete}
      />
    </div>
  );
}
