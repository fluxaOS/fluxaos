'use client';

import { notFound, useParams } from 'next/navigation';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { trpc } from '@/lib/trpc/client';
import { StageEditor } from './StageEditor';

export default function PipelineSettingsPage() {
  const params = useParams<{ org: string; user: string; project: string }>();
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [editingPipelineId, setEditingPipelineId] = useState<string | null>(
    null
  );

  // FLX-244: resolve the project from the URL slug, not the first DB row.
  const currentProjectQuery = trpc.project.getBySlug.useQuery({
    slug: params.project,
  });
  const projectRow = currentProjectQuery.data ?? null;
  if (currentProjectQuery.isSuccess && !projectRow) {
    notFound();
  }
  const projectId = projectRow?.id;
  const defaultPipelineId = projectRow?.defaultPipelineId ?? null;

  const pipelinesQuery = trpc.pipeline.list.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );

  const pipelines = pipelinesQuery.data ?? [];

  // FLX-228: project.update enforces the "pipeline belongs to this
  // project" invariant via the service-layer FK guard.
  const setDefaultMutation = trpc.project.update.useMutation({
    onSuccess: async () => {
      await utils.project.listByOrg.invalidate();
      await utils.project.list.invalidate();
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pipeline Settings"
        description="Configure pipelines, stages, and execution order"
        action={
          projectId ? (
            <button
              type="button"
              onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 bg-electric-violet hover:bg-accent-hover text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.3)]"
            >
              {showCreate ? 'Cancel' : 'New Pipeline'}
            </button>
          ) : undefined
        }
      />

      {showCreate && projectId && (
        <CreatePipelineForm
          projectId={projectId}
          onCreated={() => {
            setShowCreate(false);
            pipelinesQuery.refetch();
          }}
        />
      )}

      {pipelines.length === 0 ? (
        <EmptyState title="No pipelines configured" />
      ) : (
        <div className="space-y-4">
          {pipelines.map((p) => {
            const isDefault = p.id === defaultPipelineId;
            return (
              <div key={p.id} className="card-static p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{p.name}</span>
                    {isDefault && (
                      <span className="ml-2 text-xs text-soft-violet">
                        default
                      </span>
                    )}
                    {p.description && (
                      <p className="text-xs text-muted mt-0.5">
                        {p.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {!isDefault && projectId && (
                      <button
                        type="button"
                        onClick={() =>
                          setDefaultMutation.mutate({
                            id: projectId,
                            defaultPipelineId: p.id,
                          })
                        }
                        disabled={setDefaultMutation.isPending}
                        className="text-xs text-soft-violet hover:text-soft-violet-hover disabled:opacity-50"
                      >
                        Set as default
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setEditingPipelineId(
                          editingPipelineId === p.id ? null : p.id
                        )
                      }
                      className="text-xs text-muted hover:text-foreground"
                    >
                      {editingPipelineId === p.id ? 'Close' : 'Stages'}
                    </button>
                  </div>
                </div>
                {editingPipelineId === p.id && (
                  <StageEditor pipelineId={p.id} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreatePipelineForm({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const createMutation = trpc.pipeline.create.useMutation({
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
        <span className="text-xs text-muted">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
        />
      </label>
      <label className="flex-1">
        <span className="text-xs text-muted">Description</span>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
        />
      </label>
      <button
        type="submit"
        disabled={!name.trim() || createMutation.isPending}
        className="px-4 py-1.5 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
      >
        Create
      </button>
    </form>
  );
}
