// src/app/[org]/[user]/[project]/settings/projects/page.tsx
'use client';

import { notFound, useParams } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { trpc } from '@/lib/trpc/client';
import { type ProjectRecord, projectDescriptor } from './descriptor';

export default function ProjectsSettingsPage() {
  const params = useParams<{ org: string; user: string; project: string }>();
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);

  // Resolve the org from the URL slug — gives us the orgId we need to
  // scope the project list without an unscoped all-tenants query.
  const orgQuery = trpc.organization.getBySlug.useQuery({ slug: params.org });
  const orgId = orgQuery.data?.id ?? null;

  const projectsQuery = trpc.project.list.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const envQuery = trpc.system.env.getPublic.useQuery();

  const updateMutation = trpc.project.update.useMutation();
  const deleteMutation = trpc.project.delete.useMutation();

  const projects = projectsQuery.data ?? [];
  const currentProject =
    projects.find((project) => project.slug === params.project) ?? null;
  // Once the projects list has loaded and the URL slug still doesn't
  // resolve, the route is invalid — surface a 404 instead of silently
  // falling back to a hard-coded seed slug.
  if (projectsQuery.isSuccess && projects.length > 0 && !currentProject) {
    notFound();
  }
  const envValue = envQuery.data?.FLUXAOS_TARGET_REPO_PATH ?? null;

  // FLX-60: Create form needs an orgId + userId. The seeded project provides
  // both. Multi-org/user is out of scope for alpha (matrix § Out of Scope),
  // so the first project's identifiers are the canonical handle for now.
  const seedOrgId = currentProject?.orgId ?? projects[0]?.orgId ?? null;
  const seedUserId = currentProject?.userId ?? projects[0]?.userId ?? null;
  const seedProjectId = currentProject?.id ?? projects[0]?.id ?? null;

  // Pipelines are scoped to the current project — only load once we have it.
  const pipelinesQuery = trpc.pipeline.list.useQuery(
    { projectId: seedProjectId! },
    { enabled: !!seedProjectId }
  );
  const pipelines = pipelinesQuery.data ?? [];
  const brandsQuery = trpc.brand.listVisibleToProject.useQuery(
    { orgId: seedOrgId!, projectId: seedProjectId! },
    { enabled: !!seedOrgId && !!seedProjectId }
  );
  const brands = brandsQuery.data ?? [];

  const records: ProjectRecord[] = projects.map((p) => {
    const pipe = p.defaultPipelineId
      ? pipelines.find((x) => x.id === p.defaultPipelineId)
      : null;
    return {
      id: p.id,
      version: 1,
      name: p.name,
      slug: p.slug,
      repoUrl: p.repoUrl,
      defaultBranch: p.defaultBranch,
      defaultPipelineName:
        pipe?.name ?? '(none — set one from the Pipelines tab)',
      targetRepoPath: envValue ?? '(not set — daemon will refuse to acquire)',
    };
  });

  const onSave = async (
    id: string,
    patch: Partial<ProjectRecord>,
    _expectedVersion: number
  ) => {
    // Strip derived/readonly fields — the router only accepts the raw
    // project columns. defaultPipelineName / targetRepoPath are UI-only.
    const {
      defaultPipelineName: _dp,
      targetRepoPath: _trp,
      ...writable
    } = patch;
    await updateMutation.mutateAsync({
      id,
      ...(writable as Record<string, unknown>),
    });
    await utils.project.list.invalidate();
  };

  const onDelete = async (id: string, _expectedVersion: number) => {
    await deleteMutation.mutateAsync({ id });
    await utils.project.list.invalidate();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects"
        description="Configure the target repository and default pipeline. The target repo path is env-backed (FLUXAOS_TARGET_REPO_PATH) for alpha."
        action={
          seedOrgId && seedUserId ? (
            <button
              type="button"
              onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 bg-electric-violet hover:bg-accent-hover text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.3)]"
            >
              {showCreate ? 'Cancel' : 'New Project'}
            </button>
          ) : undefined
        }
      />

      {showCreate && seedOrgId && seedUserId && (
        <CreateProjectForm
          orgId={seedOrgId}
          userId={seedUserId}
          onCreated={async () => {
            setShowCreate(false);
            await utils.project.list.invalidate();
          }}
        />
      )}

      <RecordEditor<ProjectRecord>
        descriptor={projectDescriptor}
        records={records}
        isLoading={projectsQuery.isLoading}
        onSave={onSave}
        onDelete={onDelete}
        onRefresh={async () => {
          await utils.project.list.invalidate();
        }}
      />

      {brands.length > 0 && (
        <section className="card-static p-4 space-y-3">
          <h2 className="text-sm font-semibold text-white">
            Project default brands
          </h2>
          <div className="space-y-3">
            {projects.map((project) => (
              <label
                key={project.id}
                className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)] md:items-center"
              >
                <span className="text-xs text-slate-400">{project.name}</span>
                <select
                  value={project.brandId ?? ''}
                  onChange={async (e) => {
                    await updateMutation.mutateAsync({
                      id: project.id,
                      brandId: e.target.value || null,
                    });
                    await utils.project.list.invalidate();
                  }}
                  aria-label={`Default brand for ${project.name}`}
                  className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground"
                >
                  <option value="">No brand</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CreateProjectForm({
  orgId,
  userId,
  onCreated,
}: {
  orgId: string;
  userId: string;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [repoUrl, setRepoUrl] = useState('');

  const createMutation = trpc.project.create.useMutation({
    onSuccess: () => onCreated(),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !slug.trim()) return;
        createMutation.mutate({
          orgId,
          userId,
          name: name.trim(),
          slug: slug.trim(),
          repoUrl: repoUrl.trim() || undefined,
        });
      }}
      className="card-static p-4 flex gap-3 items-end flex-wrap"
    >
      <label className="flex-1 min-w-[180px]">
        <span className="text-xs text-slate-400">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Project name"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
        />
      </label>
      <label className="flex-1 min-w-[180px]">
        <span className="text-xs text-slate-400">Slug</span>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          aria-label="Project slug"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
        />
      </label>
      <label className="flex-1 min-w-[220px]">
        <span className="text-xs text-slate-400">Repo URL (optional)</span>
        <input
          type="text"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          aria-label="Project repo URL"
          placeholder="https://github.com/owner/repo"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
        />
      </label>
      <button
        type="submit"
        disabled={!name.trim() || !slug.trim() || createMutation.isPending}
        className="px-4 py-1.5 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
      >
        {createMutation.isPending ? 'Creating…' : 'Create'}
      </button>
    </form>
  );
}
