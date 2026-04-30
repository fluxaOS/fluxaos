'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { trpc } from '@/lib/trpc/client';

type Brand = {
  id: string;
  orgId: string;
  projectId: string | null;
  name: string;
  colors: unknown;
  fonts: unknown;
  toneOfVoice: string | null;
  styleGuide: string | null;
  logoUrl: string | null;
};

type BrandFormValues = {
  name: string;
  scope: 'org' | 'project';
  toneOfVoice: string;
  styleGuide: string;
  colors: string;
  fonts: string;
  logoUrl: string;
};

const emptyForm: BrandFormValues = {
  name: '',
  scope: 'org',
  toneOfVoice: '',
  styleGuide: '',
  colors: '',
  fonts: '',
  logoUrl: '',
};

function stringifyJson(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  return JSON.stringify(value, null, 2);
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function valuesFromBrand(brand: Brand): BrandFormValues {
  return {
    name: brand.name,
    scope: brand.projectId ? 'project' : 'org',
    toneOfVoice: brand.toneOfVoice ?? '',
    styleGuide: brand.styleGuide ?? '',
    colors: stringifyJson(brand.colors),
    fonts: stringifyJson(brand.fonts),
    logoUrl: brand.logoUrl ?? '',
  };
}

export default function BrandSettingsPage() {
  const utils = trpc.useUtils();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const orgsQuery = trpc.organization.list.useQuery();
  const orgId = orgsQuery.data?.[0]?.id ?? null;
  const projectsQuery = trpc.project.listByOrg.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId }
  );
  const projectId = projectsQuery.data?.[0]?.id ?? null;
  const brandsQuery = trpc.brand.listVisibleToProject.useQuery(
    { orgId: orgId!, projectId: projectId! },
    { enabled: !!orgId && !!projectId }
  );
  const brands = (brandsQuery.data ?? []) as Brand[];

  const invalidateBrands = async () => {
    await utils.brand.listVisibleToProject.invalidate();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Brands"
        description="Manage runtime brand context for agent output."
        action={
          orgId && projectId ? (
            <button
              type="button"
              onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 bg-electric-violet hover:bg-accent-hover text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.3)]"
            >
              {showCreate ? 'Cancel' : 'New Brand'}
            </button>
          ) : undefined
        }
      />

      {showCreate && orgId && projectId && (
        <BrandForm
          mode="create"
          orgId={orgId}
          projectId={projectId}
          initialValues={emptyForm}
          onSaved={async () => {
            setShowCreate(false);
            await invalidateBrands();
          }}
        />
      )}

      {brands.length === 0 ? (
        <EmptyState title="No brands configured" />
      ) : (
        <ul className="space-y-3">
          {brands.map((brand) => (
            <li key={brand.id} className="card-static p-4">
              {editingId === brand.id && orgId && projectId ? (
                <BrandForm
                  mode="edit"
                  brandId={brand.id}
                  orgId={orgId}
                  projectId={projectId}
                  initialValues={valuesFromBrand(brand)}
                  onSaved={async () => {
                    setEditingId(null);
                    await invalidateBrands();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <BrandRow
                  brand={brand}
                  onEdit={() => setEditingId(brand.id)}
                  onDeleted={invalidateBrands}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BrandRow({
  brand,
  onEdit,
  onDeleted,
}: {
  brand: Brand;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{brand.name}</span>
          <span className="text-xs text-slate-400">
            {brand.projectId ? 'project' : 'organization'}
          </span>
        </div>
        {brand.toneOfVoice && (
          <p className="text-xs text-slate-400 mt-1">{brand.toneOfVoice}</p>
        )}
        {brand.styleGuide && (
          <p className="text-xs text-slate-500 mt-1 line-clamp-2">
            {brand.styleGuide}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onEdit}
          className="text-xs text-slate-400 hover:text-slate-300"
        >
          Edit
        </button>
        <DeleteBrandButton brandId={brand.id} onDeleted={onDeleted} />
      </div>
    </div>
  );
}

function BrandForm({
  mode,
  brandId,
  orgId,
  projectId,
  initialValues,
  onSaved,
  onCancel,
}: {
  mode: 'create' | 'edit';
  brandId?: string;
  orgId: string;
  projectId: string;
  initialValues: BrandFormValues;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<BrandFormValues>(initialValues);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const createBrand = trpc.brand.create.useMutation({ onSuccess: onSaved });
  const updateBrand = trpc.brand.update.useMutation({ onSuccess: onSaved });

  const isPending = createBrand.isPending || updateBrand.isPending;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!values.name.trim()) return;
        setJsonError(null);

        let colors: Record<string, unknown> | null;
        let fonts: Record<string, unknown> | null;
        try {
          colors = parseJsonObject(values.colors);
          fonts = parseJsonObject(values.fonts);
        } catch (error) {
          setJsonError(
            error instanceof Error ? error.message : 'Expected a JSON object.'
          );
          return;
        }

        const payload = {
          projectId: values.scope === 'project' ? projectId : null,
          name: values.name.trim(),
          toneOfVoice: values.toneOfVoice.trim() || null,
          styleGuide: values.styleGuide.trim() || null,
          colors,
          fonts,
          logoUrl: values.logoUrl.trim() || null,
        };

        if (mode === 'create') {
          createBrand.mutate({ orgId, ...payload });
        } else if (brandId) {
          updateBrand.mutate({ id: brandId, ...payload });
        }
      }}
      className="card-static p-4 space-y-3"
    >
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
        <label>
          <span className="text-xs text-slate-400">Name</span>
          <input
            type="text"
            value={values.name}
            onChange={(e) =>
              setValues((current) => ({ ...current, name: e.target.value }))
            }
            aria-label="Brand name"
            className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
          />
        </label>
        <label>
          <span className="text-xs text-slate-400">Scope</span>
          <select
            value={values.scope}
            onChange={(e) =>
              setValues((current) => ({
                ...current,
                scope: e.target.value as 'org' | 'project',
              }))
            }
            aria-label="Brand scope"
            className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
          >
            <option value="org">organization</option>
            <option value="project">project</option>
          </select>
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label>
          <span className="text-xs text-slate-400">Tone of voice</span>
          <textarea
            value={values.toneOfVoice}
            onChange={(e) =>
              setValues((current) => ({
                ...current,
                toneOfVoice: e.target.value,
              }))
            }
            rows={4}
            aria-label="Tone of voice"
            className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-foreground mt-1 resize-none"
          />
        </label>
        <label>
          <span className="text-xs text-slate-400">Style guide</span>
          <textarea
            value={values.styleGuide}
            onChange={(e) =>
              setValues((current) => ({
                ...current,
                styleGuide: e.target.value,
              }))
            }
            rows={4}
            aria-label="Style guide"
            className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-foreground mt-1 resize-none"
          />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label>
          <span className="text-xs text-slate-400">Colors JSON</span>
          <textarea
            value={values.colors}
            onChange={(e) =>
              setValues((current) => ({ ...current, colors: e.target.value }))
            }
            rows={4}
            aria-label="Colors JSON"
            placeholder='{"primary":"#5B21B6"}'
            className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-foreground mt-1 resize-none font-mono"
          />
        </label>
        <label>
          <span className="text-xs text-slate-400">Fonts JSON</span>
          <textarea
            value={values.fonts}
            onChange={(e) =>
              setValues((current) => ({ ...current, fonts: e.target.value }))
            }
            rows={4}
            aria-label="Fonts JSON"
            placeholder='{"sans":"Inter"}'
            className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-foreground mt-1 resize-none font-mono"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-xs text-slate-400">Logo URL</span>
        <input
          type="text"
          value={values.logoUrl}
          onChange={(e) =>
            setValues((current) => ({ ...current, logoUrl: e.target.value }))
          }
          aria-label="Logo URL"
          className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-sm text-foreground mt-1"
        />
      </label>

      {jsonError && <p className="text-xs text-red-400">{jsonError}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!values.name.trim() || isPending}
          className="px-4 py-1.5 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
        >
          {isPending ? 'Saving...' : mode === 'create' ? 'Create' : 'Save'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-slate-400 text-sm"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function DeleteBrandButton({
  brandId,
  onDeleted,
}: {
  brandId: string;
  onDeleted: () => void;
}) {
  const deleteBrand = trpc.brand.delete.useMutation({ onSuccess: onDeleted });

  return (
    <button
      type="button"
      onClick={() => {
        if (confirm('Delete this brand?')) {
          deleteBrand.mutate({ id: brandId });
        }
      }}
      disabled={deleteBrand.isPending}
      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
    >
      {deleteBrand.isPending ? 'Deleting...' : 'Delete'}
    </button>
  );
}
