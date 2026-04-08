'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { trpc } from '@/lib/trpc/client';

export default function PersonaSettingsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const personasQuery = trpc.persona.list.useQuery();
  const personas = personasQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Personas</h2>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-md transition-colors"
        >
          {showCreate ? 'Cancel' : 'New Persona'}
        </button>
      </div>

      {showCreate && (
        <CreatePersonaForm
          onCreated={() => {
            setShowCreate(false);
            personasQuery.refetch();
          }}
        />
      )}

      {personas.length === 0 ? (
        <EmptyState title="No personas configured" />
      ) : (
        <div className="space-y-3">
          {personas.map((p) => (
            <div
              key={p.id}
              className="bg-sidebar border border-sidebar-border rounded-lg p-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-xs text-muted">{p.scope}</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId(expandedId === p.id ? null : p.id)
                  }
                  className="text-xs text-muted hover:text-foreground"
                >
                  {expandedId === p.id ? 'Close' : 'Details'}
                </button>
              </div>

              {p.soul && (
                <p className="text-xs text-muted mt-1 line-clamp-2">{p.soul}</p>
              )}

              {expandedId === p.id && <PersonaDetail personaId={p.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreatePersonaForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [soul, setSoul] = useState('');
  const [scope, setScope] = useState<'global' | 'project'>('project');

  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const projectsQuery = trpc.project.list.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const projectId = projectsQuery.data?.[0]?.id;

  const createMutation = trpc.persona.create.useMutation({
    onSuccess: () => onCreated(),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        createMutation.mutate({
          name: name.trim(),
          soul: soul.trim() || undefined,
          scope,
          projectId: scope === 'project' ? projectId : undefined,
        });
      }}
      className="bg-sidebar border border-sidebar-border rounded-lg p-4 space-y-3"
    >
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="text-xs text-muted">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-background border border-sidebar-border rounded-md px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
        <label>
          <span className="text-xs text-muted">Scope</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'global' | 'project')}
            className="w-full bg-background border border-sidebar-border rounded-md px-3 py-1.5 text-sm text-foreground mt-1"
          >
            <option value="project">project</option>
            <option value="global">global</option>
          </select>
        </label>
      </div>
      <label>
        <span className="text-xs text-muted">Soul</span>
        <textarea
          value={soul}
          onChange={(e) => setSoul(e.target.value)}
          rows={3}
          placeholder="Describe this persona's character and approach..."
          className="w-full bg-background border border-sidebar-border rounded-md px-3 py-2 text-sm text-foreground mt-1 resize-none"
        />
      </label>
      <button
        type="submit"
        disabled={!name.trim() || createMutation.isPending}
        className="px-4 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
      >
        {createMutation.isPending ? 'Creating...' : 'Create'}
      </button>
    </form>
  );
}

function PersonaDetail({ personaId }: { personaId: string }) {
  const personaQuery = trpc.persona.getById.useQuery({
    id: personaId,
    resolve: true,
  });
  const skillsQuery = trpc.persona.skills.useQuery({ personaId });
  const allSkillsQuery = trpc.skill.list.useQuery();

  const attachSkill = trpc.persona.attachSkill.useMutation({
    onSuccess: () => skillsQuery.refetch(),
  });
  const detachSkill = trpc.persona.detachSkill.useMutation({
    onSuccess: () => skillsQuery.refetch(),
  });

  const persona = personaQuery.data;
  const attachedSkills = skillsQuery.data ?? [];
  const allSkills = allSkillsQuery.data ?? [];
  const attachedSkillIds = new Set(attachedSkills.map((s) => s.skillId));
  const availableSkills = allSkills.filter((s) => !attachedSkillIds.has(s.id));

  if (!persona) return null;

  return (
    <div className="mt-3 pt-3 border-t border-sidebar-border space-y-3">
      {persona.identity != null && (
        <div>
          <span className="text-xs text-muted">Identity:</span>
          <pre className="text-xs text-foreground/70 mt-1 bg-background rounded p-2 overflow-x-auto">
            {JSON.stringify(persona.identity, null, 2)}
          </pre>
        </div>
      )}

      <div>
        <span className="text-xs text-muted">Attached Skills:</span>
        {attachedSkills.length === 0 ? (
          <p className="text-xs text-muted/70 mt-1">No skills attached.</p>
        ) : (
          <div className="flex flex-wrap gap-1 mt-1">
            {attachedSkills.map((ps) => (
              <span
                key={ps.skillId}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/5 rounded text-xs"
              >
                {ps.skillName ?? ps.skillId.slice(0, 8)}
                <button
                  type="button"
                  onClick={() =>
                    detachSkill.mutate({
                      personaId,
                      skillId: ps.skillId,
                    })
                  }
                  className="text-red-400 hover:text-red-300"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {availableSkills.length > 0 && (
        <div>
          <span className="text-xs text-muted">Attach skill:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {availableSkills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() =>
                  attachSkill.mutate({ personaId, skillId: skill.id })
                }
                className="px-2 py-0.5 text-xs bg-accent/10 hover:bg-accent/20 text-accent rounded transition-colors"
              >
                + {skill.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
