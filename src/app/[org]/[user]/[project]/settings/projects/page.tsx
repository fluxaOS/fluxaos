// src/app/[org]/[user]/[project]/settings/projects/page.tsx
'use client';

import { notFound, useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { openConfirmModal } from '@/components/confirm-modal';
import { PageHeader } from '@/components/page-header';
import { RecordEditor } from '@/components/record-editor/RecordEditor';
import { trpc } from '@/lib/trpc/client';
import { buildProjectDescriptor } from './buildProjectDescriptor';
import type { ProjectRecord } from './descriptor';

export default function ProjectsSettingsPage() {
  const params = useParams<{ org: string; user: string; project: string }>();
  const router = useRouter();
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

  // The seeded project provides org/user/project handles for the
  // create form and the FK option queries below. Multi-org/user is
  // out of scope for alpha (matrix § Out of Scope).
  const seedOrgId = currentProject?.orgId ?? projects[0]?.orgId ?? null;
  const seedUserId = currentProject?.userId ?? projects[0]?.userId ?? null;
  const seedProjectId = currentProject?.id ?? projects[0]?.id ?? null;

  // Pipelines are scoped to the current project — only load once we
  // have it. Drives the defaultPipelineId dropdown.
  const pipelinesQuery = trpc.pipeline.list.useQuery(
    { projectId: seedProjectId! },
    { enabled: !!seedProjectId }
  );
  const pipelines = pipelinesQuery.data ?? [];

  // Brands are org-scoped with optional project visibility — drives
  // the brandId dropdown (FLX-229 folds the standalone <section> in).
  const brandsQuery = trpc.brand.listVisibleToProject.useQuery(
    { orgId: seedOrgId!, projectId: seedProjectId! },
    { enabled: !!seedOrgId && !!seedProjectId }
  );
  const brands = brandsQuery.data ?? [];

  // FLX-207 / FLX-229: build the descriptor with dropdown options from
  // the loaded queries. Stable identity via useMemo so RecordEditor's
  // internal effects don't churn on every render.
  const descriptor = useMemo(
    () =>
      buildProjectDescriptor({
        pipelineOptions: pipelines.map((p) => ({
          value: p.id,
          label: p.name,
        })),
        brandOptions: brands.map((b) => ({ value: b.id, label: b.name })),
      }),
    [pipelines, brands]
  );

  const records: ProjectRecord[] = projects.map((p) => ({
    id: p.id,
    version: 1,
    name: p.name,
    slug: p.slug,
    repoUrl: p.repoUrl,
    defaultBranch: p.defaultBranch,
    defaultPipelineId: p.defaultPipelineId,
    brandId: p.brandId,
    targetRepoPath: p.targetRepoPath,
  }));

  const onSave = async (
    id: string,
    patch: Partial<ProjectRecord>,
    _expectedVersion: number
  ) => {
    // FLX-226: slug rename = confirm + redirect after save. We compare
    // against the record's current slug (not URL params) so the modal
    // copy matches what the operator actually changed.
    const target = records.find((r) => r.id === id);
    const slugChanged =
      'slug' in patch && target != null && patch.slug !== target.slug;
    if (slugChanged) {
      const confirmed = await openConfirmModal({
        title: 'Rename project slug?',
        body: 'Renaming the project slug invalidates all existing URLs and bookmarks for this project. Continue?',
        confirmLabel: 'Rename',
        destructive: true,
      });
      if (!confirmed) return;
    }

    await updateMutation.mutateAsync({
      id,
      ...(patch as Record<string, unknown>),
    });

    // FLX-226: on slug rename, navigate to the new URL BEFORE
    // invalidating the project list. If invalidate runs first, the
    // page re-renders with the new list, the URL param is still the
    // old slug, `currentProject` resolves to null, and notFound()
    // throws — yielding a 404 instead of the expected redirect.
    if (slugChanged && typeof patch.slug === 'string') {
      router.replace(
        `/${params.org}/${params.user}/${patch.slug}/settings/projects`
      );
    }
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
        description="Configure the target repository and default pipeline. The target repo path is a per-project column; the stage runner refuses to acquire isolation when it is null."
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
        descriptor={descriptor}
        records={records}
        isLoading={projectsQuery.isLoading}
        onSave={onSave}
        onDelete={onDelete}
        onRefresh={async () => {
          await utils.project.list.invalidate();
        }}
      />
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
