'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { RuleBuilder } from '@/components/gates/RuleBuilder';
import { RuleTestPanel } from '@/components/gates/RuleTestPanel';
import { trpc } from '@/lib/trpc/client';
import type { RuleGroup, GateMode } from '@/core/gates/types';

export default function PipelineSettingsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [editingPipelineId, setEditingPipelineId] = useState<string | null>(null);

  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const projectsQuery = trpc.project.listByOrg.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId },
  );
  const projectId = projectsQuery.data?.[0]?.id;

  const pipelinesQuery = trpc.pipeline.listByProject.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId },
  );

  const pipelines = pipelinesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pipeline settings"
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
          {pipelines.map((p) => (
            <div key={p.id} className="card-static p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{p.name}</span>
                  {p.isDefault && (
                    <span className="ml-2 text-xs text-soft-violet">default</span>
                  )}
                  {p.description && (
                    <p className="text-xs text-muted mt-0.5">{p.description}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setEditingPipelineId(editingPipelineId === p.id ? null : p.id)
                  }
                  className="text-xs text-muted hover:text-foreground"
                >
                  {editingPipelineId === p.id ? 'Close' : 'Stages'}
                </button>
              </div>
              {editingPipelineId === p.id && <StageEditor pipelineId={p.id} />}
            </div>
          ))}
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

function StageEditor({ pipelineId }: { pipelineId: string }) {
  const [showAdd, setShowAdd] = useState(false);
  const stagesQuery = trpc.pipeline.stages.listByPipeline.useQuery({ pipelineId });
  const stages = stagesQuery.data ?? [];

  const skillsQuery = trpc.skill.list.useQuery();
  const driverQuery = trpc.driver.list.useQuery();
  const skills = skillsQuery.data ?? [];
  const drivers = driverQuery.data ?? [];

  const createStage = trpc.pipeline.stages.create.useMutation({
    onSuccess: () => {
      setShowAdd(false);
      stagesQuery.refetch();
    },
  });

  const [newName, setNewName] = useState('');
  const [newGateMode, setNewGateMode] = useState<string>('auto');
  const [newGateRules, setNewGateRules] = useState<RuleGroup | null>(null);
  const [newSkillId, setNewSkillId] = useState('');
  const [newDriverId, setNewDriverId] = useState('');

  return (
    <div className="mt-3 pt-3 border-t border-slate-700/20 space-y-2">
      {stages.length === 0 ? (
        <p className="text-xs text-muted">No stages configured.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted text-left">
              <th className="pr-3 py-1 font-medium">#</th>
              <th className="pr-3 py-1 font-medium">Name</th>
              <th className="pr-3 py-1 font-medium">Gate</th>
              <th className="pr-3 py-1 font-medium">Skill</th>
              <th className="pr-3 py-1 font-medium">Driver</th>
              <th className="pr-3 py-1 font-medium">Timeout</th>
              <th className="pr-3 py-1 font-medium">Retries</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((s: typeof stages[number]) => (
              <tr key={s.id} className="text-foreground/80">
                <td className="pr-3 py-1">{s.sortOrder}</td>
                <td className="pr-3 py-1 capitalize">{s.name}</td>
                <td className="pr-3 py-1">{s.gateMode}</td>
                <td className="pr-3 py-1">{skills.find((sk: typeof skills[number]) => sk.id === s.skillId)?.name ?? '—'}</td>
                <td className="pr-3 py-1">{drivers.find((h: typeof drivers[number]) => h.id === s.driverId)?.name ?? '—'}</td>
                <td className="pr-3 py-1">{s.timeoutSec}s</td>
                <td className="pr-3 py-1">{s.maxRetries}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showAdd ? (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              createStage.mutate({
                pipelineId,
                name: newName.trim(),
                sortOrder: stages.length + 1,
                gateMode: newGateMode,
                gateRules: newGateMode === 'rules' ? newGateRules : undefined,
                skillId: newSkillId || undefined,
                driverId: newDriverId || undefined,
              });
            }}
            className="flex gap-2 items-end"
          >
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Stage name"
              className="bg-slate-900 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-foreground"
            />
            <select
              value={newGateMode}
              onChange={(e) => setNewGateMode(e.target.value)}
              className="bg-slate-900 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-foreground"
            >
              <option value="auto">auto</option>
              <option value="rules">rules</option>
              <option value="hold">hold</option>
            </select>
            <select
              value={newSkillId}
              onChange={(e) => setNewSkillId(e.target.value)}
              className="bg-slate-900 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-foreground"
            >
              <option value="">No skill</option>
              {skills.map((s: typeof skills[number]) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select
              value={newDriverId}
              onChange={(e) => setNewDriverId(e.target.value)}
              className="bg-slate-900 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-foreground"
            >
              <option value="">No driver</option>
              {drivers.map((h: typeof drivers[number]) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={createStage.isPending}
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
          {newGateMode === 'rules' && (
            <div className="space-y-3 mt-3">
              <RuleBuilder rules={newGateRules} onChange={setNewGateRules} />
              <RuleTestPanel
                mode={newGateMode as GateMode}
                rules={newGateRules}
              />
            </div>
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="text-xs text-soft-violet hover:text-soft-violet-hover"
        >
          + Add Stage
        </button>
      )}
    </div>
  );
}
