'use client';

import { useState } from 'react';
import { openConfirmModal } from '@/components/confirm-modal';
import { RuleBuilder } from '@/components/gates/RuleBuilder';
import { RuleTestPanel } from '@/components/gates/RuleTestPanel';
import { PIPELINE_SENTINEL } from '@/core/constants';
import type { GateMode, RuleGroup } from '@/core/gates/types';
import { trpc } from '@/lib/trpc/client';

/** Options for onPass/onFail/fallback selects: sentinels + sibling stage names */
function RoutingSelect({
  ariaLabel,
  value,
  onChange,
  stageOptions,
}: {
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  stageOptions: string[];
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-36 bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-xs text-foreground"
    >
      <option value="">— none —</option>
      <option value={PIPELINE_SENTINEL.complete}>
        {PIPELINE_SENTINEL.complete}
      </option>
      <option value={PIPELINE_SENTINEL.blocked}>
        {PIPELINE_SENTINEL.blocked}
      </option>
      {stageOptions.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

export function StageEditor({ pipelineId }: { pipelineId: string }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const stagesQuery = trpc.pipeline.stages.listByPipeline.useQuery({
    pipelineId,
  });
  const stages = stagesQuery.data ?? [];

  // Load global personas (scope='global') for stage assignment. Project-scoped
  // personas can be added via persona.listByProject if needed.
  const personaQuery = trpc.persona.list.useQuery({});
  const driverQuery = trpc.driver.list.useQuery();
  const personas = personaQuery.data ?? [];
  const drivers = driverQuery.data ?? [];

  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const createStage = trpc.pipeline.stages.create.useMutation({
    onSuccess: () => {
      setShowAdd(false);
      setCreateError(null);
      setNewName('');
      setNewGateMode('auto');
      setNewGateRules(null);
      setNewPersonaId('');
      setNewDriverId('');
      setNewOnPass('');
      setNewOnFail('');
      setNewFallback('');
      stagesQuery.refetch();
    },
    onError: (err) => {
      setCreateError(err.message);
    },
  });

  const updateStage = trpc.pipeline.stages.update.useMutation({
    onSuccess: () => {
      setEditingStageId(null);
      setUpdateError(null);
      stagesQuery.refetch();
    },
    onError: (err) => {
      setUpdateError(err.message);
    },
  });

  const deleteStage = trpc.pipeline.stages.delete.useMutation({
    onSuccess: () => {
      setEditingStageId(null);
      stagesQuery.refetch();
    },
  });

  const [newName, setNewName] = useState('');
  const [newGateMode, setNewGateMode] = useState<string>('auto');
  const [newGateRules, setNewGateRules] = useState<RuleGroup | null>(null);
  const [newPersonaId, setNewPersonaId] = useState<string>('');
  const [newDriverId, setNewDriverId] = useState('');
  const [newOnPass, setNewOnPass] = useState<string>('');
  const [newOnFail, setNewOnFail] = useState<string>('');
  const [newFallback, setNewFallback] = useState<string>('');

  const [editName, setEditName] = useState('');
  const [editSortOrder, setEditSortOrder] = useState(1);
  const [editGateMode, setEditGateMode] = useState<string>('auto');
  const [editPersonaId, setEditPersonaId] = useState<string>('');
  const [editDriverId, setEditDriverId] = useState('');
  const [editTimeoutSec, setEditTimeoutSec] = useState(300);
  const [editMaxRetries, setEditMaxRetries] = useState(0);
  const [editOnPass, setEditOnPass] = useState<string>('');
  const [editOnFail, setEditOnFail] = useState<string>('');
  const [editFallback, setEditFallback] = useState<string>('');

  function startEditing(stage: (typeof stages)[number]) {
    setEditingStageId(stage.id);
    setEditName(stage.name);
    setEditSortOrder(stage.sortOrder);
    setEditGateMode(stage.gateMode ?? 'auto');
    setEditPersonaId(stage.personaId ?? '');
    setEditDriverId(stage.driverId ?? '');
    setEditTimeoutSec(stage.timeoutSec ?? 300);
    setEditMaxRetries(stage.maxRetries ?? 0);
    setEditOnPass(stage.onPass ?? '');
    setEditOnFail(stage.onFail ?? '');
    setEditFallback(stage.fallback ?? '');
  }

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
              <th className="pr-3 py-1 font-medium">Persona</th>
              <th className="pr-3 py-1 font-medium">Driver</th>
              <th className="pr-3 py-1 font-medium">On Pass</th>
              <th className="pr-3 py-1 font-medium">On Fail</th>
              <th className="pr-3 py-1 font-medium">Fallback</th>
              <th className="pr-3 py-1 font-medium">Timeout</th>
              <th className="pr-3 py-1 font-medium">Retries</th>
              <th className="pr-3 py-1 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((s: (typeof stages)[number]) => {
              const isEditing = editingStageId === s.id;
              return (
                <tr key={s.id} className="text-foreground/80">
                  <td className="pr-3 py-1">
                    {isEditing ? (
                      <input
                        aria-label="Sort order"
                        type="number"
                        value={editSortOrder}
                        onChange={(e) =>
                          setEditSortOrder(Number(e.target.value))
                        }
                        className="w-14 bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-xs text-foreground"
                      />
                    ) : (
                      s.sortOrder
                    )}
                  </td>
                  <td className="pr-3 py-1 capitalize">
                    {isEditing ? (
                      <input
                        aria-label="Stage name"
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-40 bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-xs text-foreground"
                      />
                    ) : (
                      s.name
                    )}
                  </td>
                  <td className="pr-3 py-1">
                    {isEditing ? (
                      <select
                        aria-label="Gate mode"
                        value={editGateMode}
                        onChange={(e) => setEditGateMode(e.target.value)}
                        className="bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-xs text-foreground"
                      >
                        <option value="auto">auto</option>
                        <option value="rules">rules</option>
                        <option value="hold">hold</option>
                      </select>
                    ) : (
                      s.gateMode
                    )}
                  </td>
                  <td className="pr-3 py-1">
                    {isEditing ? (
                      <select
                        aria-label="Persona"
                        value={editPersonaId}
                        onChange={(e) => setEditPersonaId(e.target.value)}
                        className="bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-xs text-foreground"
                      >
                        <option value="">No persona</option>
                        {personas.map((p: (typeof personas)[number]) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      (personas.find(
                        (p: (typeof personas)[number]) => p.id === s.personaId
                      )?.name ?? '-')
                    )}
                  </td>
                  <td className="pr-3 py-1">
                    {isEditing ? (
                      <select
                        aria-label="Driver"
                        value={editDriverId}
                        onChange={(e) => setEditDriverId(e.target.value)}
                        className="bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-xs text-foreground"
                      >
                        <option value="">No driver</option>
                        {drivers.map((d: (typeof drivers)[number]) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      (drivers.find(
                        (d: (typeof drivers)[number]) => d.id === s.driverId
                      )?.name ?? '-')
                    )}
                  </td>
                  <td className="pr-3 py-1">
                    {isEditing ? (
                      <RoutingSelect
                        ariaLabel="On pass"
                        value={editOnPass}
                        onChange={setEditOnPass}
                        stageOptions={stages
                          .filter((other) => other.id !== s.id)
                          .map((other) => other.name)}
                      />
                    ) : (
                      (s.onPass ?? '-')
                    )}
                  </td>
                  <td className="pr-3 py-1">
                    {isEditing ? (
                      <RoutingSelect
                        ariaLabel="On fail"
                        value={editOnFail}
                        onChange={setEditOnFail}
                        stageOptions={stages
                          .filter((other) => other.id !== s.id)
                          .map((other) => other.name)}
                      />
                    ) : (
                      (s.onFail ?? '-')
                    )}
                  </td>
                  <td className="pr-3 py-1">
                    {isEditing ? (
                      <RoutingSelect
                        ariaLabel="Fallback"
                        value={editFallback}
                        onChange={setEditFallback}
                        stageOptions={stages
                          .filter((other) => other.id !== s.id)
                          .map((other) => other.name)}
                      />
                    ) : (
                      (s.fallback ?? '-')
                    )}
                  </td>
                  <td className="pr-3 py-1">
                    {isEditing ? (
                      <input
                        aria-label="Timeout seconds"
                        type="number"
                        min={1}
                        value={editTimeoutSec}
                        onChange={(e) =>
                          setEditTimeoutSec(Number(e.target.value))
                        }
                        className="w-20 bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-xs text-foreground"
                      />
                    ) : (
                      `${s.timeoutSec}s`
                    )}
                  </td>
                  <td className="pr-3 py-1">
                    {isEditing ? (
                      <input
                        aria-label="Max retries"
                        type="number"
                        min={0}
                        value={editMaxRetries}
                        onChange={(e) =>
                          setEditMaxRetries(Number(e.target.value))
                        }
                        className="w-16 bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-xs text-foreground"
                      />
                    ) : (
                      s.maxRetries
                    )}
                  </td>
                  <td className="pr-3 py-1">
                    {isEditing ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateStage.mutate({
                                id: s.id,
                                name: editName.trim(),
                                sortOrder: editSortOrder,
                                gateMode: editGateMode,
                                personaId: editPersonaId || undefined,
                                driverId: editDriverId || null,
                                timeoutSec: editTimeoutSec,
                                maxRetries: editMaxRetries,
                                onPass: editOnPass || null,
                                onFail: editOnFail || null,
                                fallback: editFallback || null,
                              })
                            }
                            disabled={!editName.trim() || updateStage.isPending}
                            className="text-xs text-soft-violet hover:text-soft-violet-hover disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingStageId(null);
                              setUpdateError(null);
                            }}
                            className="text-xs text-muted hover:text-foreground"
                          >
                            Cancel
                          </button>
                        </div>
                        {updateError && (
                          <p className="text-xs text-red-400">{updateError}</p>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => startEditing(s)}
                          className="text-xs text-soft-violet hover:text-soft-violet-hover"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const confirmed = await openConfirmModal({
                              title: `Delete stage "${s.name}"?`,
                              body: `This will permanently remove the "${s.name}" stage from this pipeline.`,
                              confirmLabel: 'Delete',
                              destructive: true,
                            });
                            if (confirmed) {
                              deleteStage.mutate({ id: s.id });
                            }
                          }}
                          disabled={deleteStage.isPending}
                          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
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
                personaId: newPersonaId || undefined,
                driverId: newDriverId || undefined,
                onPass: newOnPass || undefined,
                onFail: newOnFail || undefined,
                fallback: newFallback || undefined,
              });
            }}
            className="flex gap-2 items-end flex-wrap"
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
              value={newPersonaId}
              onChange={(e) => setNewPersonaId(e.target.value)}
              className="bg-slate-900 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-foreground"
            >
              <option value="">No persona</option>
              {personas.map((p: (typeof personas)[number]) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              value={newDriverId}
              onChange={(e) => setNewDriverId(e.target.value)}
              className="bg-slate-900 border border-slate-700/60 rounded-lg px-2 py-1 text-xs text-foreground"
            >
              <option value="">No driver</option>
              {drivers.map((d: (typeof drivers)[number]) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <RoutingSelect
              ariaLabel="On Pass"
              value={newOnPass}
              onChange={setNewOnPass}
              stageOptions={stages.map((s) => s.name)}
            />
            <RoutingSelect
              ariaLabel="On Fail"
              value={newOnFail}
              onChange={setNewOnFail}
              stageOptions={stages.map((s) => s.name)}
            />
            <RoutingSelect
              ariaLabel="Fallback"
              value={newFallback}
              onChange={setNewFallback}
              stageOptions={stages.map((s) => s.name)}
            />
            <button
              type="submit"
              disabled={createStage.isPending}
              className="px-2 py-1 bg-accent text-white text-xs rounded-md disabled:opacity-50"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAdd(false);
                setCreateError(null);
              }}
              className="px-2 py-1 text-muted text-xs"
            >
              Cancel
            </button>
          </form>
          {createError && (
            <p className="text-xs text-red-400 mt-1">{createError}</p>
          )}
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
