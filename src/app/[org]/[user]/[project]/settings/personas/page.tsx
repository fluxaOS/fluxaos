'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { trpc } from '@/lib/trpc/client';

type Persona = {
  id: string;
  version: number;
  name: string;
  scope: string;
  soul: string | null;
  brandId: string | null;
};

type BrandOption = {
  id: string;
  name: string;
};

export default function PersonaSettingsPage() {
  const params = useParams<{ project: string }>();
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const projectSlug = params.project ?? 'fluxaos';
  const currentProjectQuery = trpc.project.getBySlug.useQuery({
    slug: projectSlug,
  });
  const currentProject = currentProjectQuery.data ?? null;
  const projectId = currentProject?.id;
  const orgId = currentProject?.orgId;
  const brandsQuery = trpc.brand.listVisibleToProject.useQuery(
    { orgId: orgId!, projectId: projectId! },
    { enabled: !!orgId && !!projectId }
  );
  const brands = (brandsQuery.data ?? []) as BrandOption[];

  // List personas scoped to the current project (project-scoped) and global.
  // The router returns project personas when projectId is provided, global
  // personas when omitted. We load both and merge for a complete view.
  const projectPersonasQuery = trpc.persona.list.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId }
  );
  const globalPersonasQuery = trpc.persona.list.useQuery({});
  const personas = (
    [
      ...(projectPersonasQuery.data ?? []),
      ...(globalPersonasQuery.data ?? []),
    ] as Persona[]
  ).filter((p, idx, arr) => arr.findIndex((x) => x.id === p.id) === idx);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Personas"
        description="Define agent identities with custom soul prompts and skill sets"
        action={
          <button
            type="button"
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 bg-electric-violet hover:bg-accent-hover text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.3)]"
          >
            {showCreate ? 'Cancel' : 'New Persona'}
          </button>
        }
      />

      {showCreate && (
        <CreatePersonaForm
          brands={brands}
          projectId={projectId ?? null}
          onCreated={async () => {
            setShowCreate(false);
            await utils.persona.list.invalidate();
          }}
        />
      )}

      {personas.length === 0 ? (
        <EmptyState title="No personas configured" />
      ) : (
        <ul className="space-y-3">
          {personas.map((p) => (
            <li key={p.id} className="card-static p-4">
              {editingId === p.id ? (
                <EditPersonaForm
                  persona={p}
                  brands={brands}
                  onSaved={async () => {
                    setEditingId(null);
                    await utils.persona.list.invalidate();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium">{p.name}</span>
                      <span className="ml-2 text-xs text-slate-400">
                        {p.scope}
                      </span>
                      {p.brandId && (
                        <span className="ml-2 text-xs text-soft-violet">
                          {brands.find((b) => b.id === p.brandId)?.name ??
                            'branded'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedId(expandedId === p.id ? null : p.id)
                        }
                        className="text-xs text-slate-400 hover:text-slate-300"
                      >
                        {expandedId === p.id ? 'Close' : 'Details'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(p.id)}
                        className="text-xs text-slate-400 hover:text-slate-300"
                      >
                        Edit
                      </button>
                      <DeletePersonaButton
                        personaId={p.id}
                        personaVersion={p.version}
                        onDeleted={() => utils.persona.list.invalidate()}
                      />
                    </div>
                  </div>

                  {p.soul && (
                    <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                      {p.soul}
                    </p>
                  )}
                </>
              )}

              {editingId !== p.id && expandedId === p.id && (
                <PersonaDetail personaId={p.id} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditPersonaForm({
  persona,
  brands,
  onSaved,
  onCancel,
}: {
  persona: Persona;
  brands: BrandOption[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(persona.name);
  const [soul, setSoul] = useState(persona.soul ?? '');
  const [brandId, setBrandId] = useState(persona.brandId ?? '');

  const updateMutation = trpc.persona.update.useMutation({
    onSuccess: () => onSaved(),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        updateMutation.mutate({
          id: persona.id,
          version: persona.version,
          name: name.trim(),
          soul: soul.trim() || undefined,
          brandId: brandId || null,
        });
      }}
      className="space-y-3"
    >
      <label className="block">
        <span className="text-xs text-slate-400">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Persona name"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
        />
      </label>
      <label className="block">
        <span className="text-xs text-slate-400">Soul</span>
        <textarea
          value={soul}
          onChange={(e) => setSoul(e.target.value)}
          rows={3}
          aria-label="Persona soul"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-foreground mt-1 resize-none"
        />
      </label>
      <label className="block">
        <span className="text-xs text-slate-400">Brand</span>
        <select
          value={brandId}
          onChange={(e) => setBrandId(e.target.value)}
          aria-label="Persona brand"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
        >
          <option value="">No brand</option>
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
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
      </div>
    </form>
  );
}

function DeletePersonaButton({
  personaId,
  personaVersion,
  onDeleted,
}: {
  personaId: string;
  personaVersion: number;
  onDeleted: () => void;
}) {
  const deleteMutation = trpc.persona.delete.useMutation({
    onSuccess: () => onDeleted(),
  });

  return (
    <button
      type="button"
      onClick={() => {
        if (confirm('Delete this persona?')) {
          deleteMutation.mutate({ id: personaId, version: personaVersion });
        }
      }}
      disabled={deleteMutation.isPending}
      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
    >
      {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
    </button>
  );
}

function CreatePersonaForm({
  brands,
  projectId,
  onCreated,
}: {
  brands: BrandOption[];
  projectId: string | null;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [soul, setSoul] = useState('');
  const [scope, setScope] = useState<'global' | 'project'>('project');
  const [brandId, setBrandId] = useState('');

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
          projectId: scope === 'project' && projectId ? projectId : undefined,
          brandId: brandId || undefined,
        });
      }}
      className="card-static p-4 space-y-3"
    >
      <div className="flex gap-3">
        <label className="flex-1">
          <span className="text-xs text-slate-400">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Persona name"
            className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
        <label>
          <span className="text-xs text-slate-400">Scope</span>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'global' | 'project')}
            aria-label="Persona scope"
            className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
          >
            <option value="project">project</option>
            <option value="global">global</option>
          </select>
        </label>
      </div>
      <label>
        <span className="text-xs text-slate-400">Soul</span>
        <textarea
          value={soul}
          onChange={(e) => setSoul(e.target.value)}
          rows={3}
          placeholder="Describe this persona's character and approach..."
          aria-label="Persona soul"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-foreground mt-1 resize-none"
        />
      </label>
      <label className="block">
        <span className="text-xs text-slate-400">Brand</span>
        <select
          value={brandId}
          onChange={(e) => setBrandId(e.target.value)}
          aria-label="Persona brand"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
        >
          <option value="">No brand</option>
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={
          !name.trim() ||
          (scope === 'project' && !projectId) ||
          createMutation.isPending
        }
        className="px-4 py-1.5 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
      >
        {createMutation.isPending ? 'Creating…' : 'Create'}
      </button>
    </form>
  );
}

function PersonaDetail({ personaId }: { personaId: string }) {
  const personaQuery = trpc.persona.getById.useQuery({ id: personaId });
  const skillsQuery = trpc.persona.skills.useQuery({ personaId });
  const allSkillsQuery = trpc.skill.list.useQuery({});

  const attachSkill = trpc.persona.attachSkill.useMutation({
    onSuccess: () => skillsQuery.refetch(),
  });
  const detachSkill = trpc.persona.detachSkill.useMutation({
    onSuccess: () => skillsQuery.refetch(),
  });

  const persona = personaQuery.data;
  const attachedSkills = skillsQuery.data ?? [];
  const allSkills = allSkillsQuery.data ?? [];
  const attachedSkillIds = new Set(
    attachedSkills.map((s: (typeof attachedSkills)[number]) => s.skillId)
  );
  const availableSkills = allSkills.filter(
    (s: (typeof allSkills)[number]) => !attachedSkillIds.has(s.id)
  );

  if (!persona) return null;

  return (
    <div className="mt-3 pt-3 border-t border-slate-700/20 space-y-3">
      {persona.identity != null && (
        <div>
          <span className="text-xs text-slate-400">Identity:</span>
          <pre className="text-xs text-slate-400 mt-1 bg-background rounded p-2 overflow-x-auto">
            {JSON.stringify(persona.identity, null, 2)}
          </pre>
        </div>
      )}

      <div>
        <span className="text-xs text-slate-400">Attached Skills:</span>
        {attachedSkills.length === 0 ? (
          <p className="text-xs text-slate-500 mt-1">No skills attached.</p>
        ) : (
          <div className="flex flex-wrap gap-1 mt-1">
            {attachedSkills.map((ps: (typeof attachedSkills)[number]) => (
              <span
                key={ps.skillId}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/[0.04] rounded text-xs"
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
          <span className="text-xs text-slate-400">Attach skill:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {availableSkills.map((s: (typeof availableSkills)[number]) => (
              <button
                key={s.id}
                type="button"
                onClick={() => attachSkill.mutate({ personaId, skillId: s.id })}
                className="px-2 py-0.5 text-xs bg-electric-violet/10 hover:bg-electric-violet/20 text-soft-violet rounded transition-colors"
              >
                + {s.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
