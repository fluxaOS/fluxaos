'use client';

import { useState } from 'react';
import { RuleBuilder } from '@/components/gates/RuleBuilder';
import { RuleTestPanel } from '@/components/gates/RuleTestPanel';
import type { GateMode, RuleGroup } from '@/core/gates/types';
import { trpc } from '@/lib/trpc/client';

export function StageEditor({ pipelineId }: { pipelineId: string }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const stagesQuery = trpc.pipeline.stages.listByPipeline.useQuery({
    pipelineId,
  });
  const stages = stagesQuery.data ?? [];

  const skillsQuery = trpc.skill.list.useQuery();
  const driverQuery = trpc.driver.list.useQuery();
  const skills = skillsQuery.data ?? [];
  const drivers = driverQuery.data ?? [];

  const createStage = trpc.pipeline.stages.create.useMutation({
    onSuccess: () => {
      setShowAdd(false);
      setNewName('');
      setNewGateMode('auto');
      setNewGateRules(null);
      setNewSkillId('');
      setNewDriverId('');
      stagesQuery.refetch();
    },
  });

  const updateStage = trpc.pipeline.stages.update.useMutation({
    onSuccess: () => {
      setEditingStageId(null);
      stagesQuery.refetch();
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
  const [newSkillId, setNewSkillId] = useState('');
  const [newDriverId, setNewDriverId] = useState('');

  const [editName, setEditName] = useState('');
  const [editSortOrder, setEditSortOrder] = useState(1);
  const [editGateMode, setEditGateMode] = useState<string>('auto');
  const [editSkillId, setEditSkillId] = useState('');
  const [editDriverId, setEditDriverId] = useState('');
  const [editTimeoutSec, setEditTimeoutSec] = useState(300);
  const [editMaxRetries, setEditMaxRetries] = useState(0);

  function startEditing(stage: (typeof stages)[number]) {
    setEditingStageId(stage.id);
    setEditName(stage.name);
    setEditSortOrder(stage.sortOrder);
    setEditGateMode(stage.gateMode ?? 'auto');
    setEditSkillId(stage.skillId ?? '');
    setEditDriverId(stage.driverId ?? '');
    setEditTimeoutSec(stage.timeoutSec ?? 300);
    setEditMaxRetries(stage.maxRetries ?? 0);
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
              <th className="pr-3 py-1 font-medium">Skill</th>
              <th className="pr-3 py-1 font-medium">Driver</th>
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
                        aria-label="Skill"
                        value={editSkillId}
                        onChange={(e) => setEditSkillId(e.target.value)}
                        className="bg-slate-900 border border-slate-700/60 rounded px-2 py-1 text-xs text-foreground"
                      >
                        <option value="">No skill</option>
                        {skills.map((sk: (typeof skills)[number]) => (
                          <option key={sk.id} value={sk.id}>
                            {sk.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      (skills.find(
                        (sk: (typeof skills)[number]) => sk.id === s.skillId
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
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            updateStage.mutate({
                              id: s.id,
                              name: editName.trim(),
                              sortOrder: editSortOrder,
                              gateMode: editGateMode,
                              skillId: editSkillId || null,
                              driverId: editDriverId || null,
                              timeoutSec: editTimeoutSec,
                              maxRetries: editMaxRetries,
                            })
                          }
                          disabled={!editName.trim() || updateStage.isPending}
                          className="text-xs text-soft-violet hover:text-soft-violet-hover disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingStageId(null)}
                          className="text-xs text-muted hover:text-foreground"
                        >
                          Cancel
                        </button>
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
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete stage "${s.name}" from this pipeline?`
                              )
                            ) {
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
              {skills.map((s: (typeof skills)[number]) => (
                <option key={s.id} value={s.id}>
                  {s.name}
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
