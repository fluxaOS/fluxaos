'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Card } from '@/components/card';
import { PageHeader } from '@/components/page-header';
import { trpc } from '@/lib/trpc/client';

export function IssueCreateClient({
  projectId,
  basePath,
}: {
  projectId: string;
  basePath: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // R-EPIC: when navigating here via "Create child issue", the parent's uuid
  // comes on ?parent=. Fetch the parent title for the confirmation banner
  // and pass parentIssueId into the create mutation.
  const parentIssueId = searchParams.get('parent');

  const [title, setTitle] = useState('');
  const [bodyMd, setBodyMd] = useState('');
  const [typeId, setTypeId] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [assignee, setAssignee] = useState('');

  // ── Catalog queries ──────────────────────────────────────────────────────
  const typesQuery = trpc.issueCatalog.types.list.useQuery({ projectId });
  const prioritiesQuery = trpc.issueCatalog.priorities.list.useQuery({
    projectId,
  });
  const parentQuery = trpc.issue.getById.useQuery(
    { id: parentIssueId ?? '' },
    { enabled: !!parentIssueId }
  );

  const types = typesQuery.data ?? [];
  const priorities = prioritiesQuery.data ?? [];
  const parent = parentIssueId ? parentQuery.data : null;

  // Auto-select first catalog item when data loads
  if (types.length > 0 && !typeId) {
    setTypeId(types[0].id);
  }
  if (priorities.length > 0 && !priorityId) {
    setPriorityId(priorities[0].id);
  }

  // ── Create mutation ──────────────────────────────────────────────────────
  const createMutation = trpc.issue.create.useMutation({
    onSuccess: (data) => {
      router.push(`${basePath}/issues/${data.number}`);
    },
  });

  const catalogsLoading = typesQuery.isLoading || prioritiesQuery.isLoading;

  return (
    <div className="space-y-5">
      <Link
        href={`${basePath}/issues`}
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        <ArrowLeft size={14} />
        Back to Issues
      </Link>

      <PageHeader title="New Issue" />

      {parent && (
        <Card hover={false} padding="p-4">
          <p className="text-xs text-slate-400">
            Creating child issue under{' '}
            <Link
              href={`${basePath}/issues/${parent.number}`}
              className="text-soft-violet hover:underline font-mono"
            >
              #{parent.number}
            </Link>{' '}
            — <span className="text-slate-300">{parent.title}</span>
          </p>
        </Card>
      )}

      <Card hover={false} padding="p-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim() || !typeId || !priorityId) return;
            createMutation.mutate({
              projectId,
              title: title.trim(),
              bodyMd: bodyMd.trim() || undefined,
              typeId,
              priorityId,
              assignee: assignee.trim() || undefined,
              parentIssueId: parentIssueId ?? undefined,
            });
          }}
          className="space-y-4"
        >
          {/* Title */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Issue title"
              required
              className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-violet/30"
            />
          </div>

          {/* Body */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Description
            </label>
            <textarea
              value={bodyMd}
              onChange={(e) => setBodyMd(e.target.value)}
              placeholder="Describe the issue (Markdown)"
              rows={5}
              className="w-full bg-slate-900 border border-slate-700/60 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-violet/30 resize-y"
            />
          </div>

          {/* Type + Priority + Assignee row */}
          <div className="flex flex-wrap gap-4">
            {/* Type dropdown (from catalog) */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Type *
              </label>
              <select
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                disabled={catalogsLoading}
                className="bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-electric-violet/30"
              >
                {catalogsLoading && <option>Loading...</option>}
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority dropdown (from catalog) */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Priority *
              </label>
              <select
                value={priorityId}
                onChange={(e) => setPriorityId(e.target.value)}
                disabled={catalogsLoading}
                className="bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-electric-violet/30"
              >
                {catalogsLoading && <option>Loading...</option>}
                {priorities.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </div>

            {/* Assignee */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                Assignee
              </label>
              <input
                type="text"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="Optional"
                className="bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-electric-violet/30 w-40"
              />
            </div>
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={
                !title.trim() ||
                !typeId ||
                !priorityId ||
                createMutation.isPending
              }
              className="px-5 py-2.5 bg-electric-violet hover:bg-accent-hover disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-[0_4px_16px_rgba(124,58,237,0.3)] hover:shadow-[0_6px_24px_rgba(124,58,237,0.4)]"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Issue'}
            </button>
            <Link
              href={`${basePath}/issues`}
              className="px-4 py-2.5 text-sm text-slate-400 hover:text-slate-300 transition-colors"
            >
              Cancel
            </Link>
          </div>

          {createMutation.error && (
            <p className="text-sm text-red-400">
              {createMutation.error.message}
            </p>
          )}
        </form>
      </Card>
    </div>
  );
}
