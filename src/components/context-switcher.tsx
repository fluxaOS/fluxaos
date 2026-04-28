// src/components/context-switcher.tsx
// FLX-1: surface the org/user/project triplet from the URL with dropdowns
// to switch between them. Sits at the top of the Nav sidebar.
//
// All three slugs are URL-driven; switching navigates to the new path
// preserving the rest of the route (e.g. /<org>/<user>/<project>/issues).
'use client';

import { ChevronsUpDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc/client';

type Slugs = {
  orgSlug: string;
  userSlug: string;
  projectSlug: string;
};

function parseSlugs(pathname: string): Slugs | null {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length < 3) return null;
  const [orgSlug, userSlug, projectSlug] = segs;
  return { orgSlug, userSlug, projectSlug };
}

function pathSuffix(pathname: string): string {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length <= 3) return '';
  return `/${segs.slice(3).join('/')}`;
}

export function ContextSwitcher() {
  const pathname = usePathname();
  const slugs = parseSlugs(pathname);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close the popover on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  // Always-fired queries — server returns lightweight rows; the user's
  // role gates mutations, not these reads.
  const orgsQuery = trpc.organization.list.useQuery();
  const orgs = orgsQuery.data ?? [];
  const currentOrg = orgs.find((o) => o.slug === slugs?.orgSlug) ?? null;

  const usersQuery = trpc.user.listByOrg.useQuery(
    { orgId: currentOrg?.id ?? '' },
    { enabled: Boolean(currentOrg) }
  );
  const users = usersQuery.data ?? [];
  const currentUser = users.find((u) => u.slug === slugs?.userSlug) ?? null;

  const projectsQuery = trpc.project.listByUser.useQuery(
    { userId: currentUser?.id ?? '' },
    { enabled: Boolean(currentUser) }
  );
  const projects = projectsQuery.data ?? [];

  if (!slugs) return null;

  const suffix = pathSuffix(pathname);

  return (
    <div className="px-3 pb-3" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Switch context"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-left text-xs hover:bg-slate-900 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="text-slate-500 truncate">
            {currentOrg?.name ?? slugs.orgSlug} ·{' '}
            {currentUser?.name ?? slugs.userSlug}
          </div>
          <div className="text-slate-200 font-semibold truncate">
            {slugs.projectSlug}
          </div>
        </div>
        <ChevronsUpDown size={14} className="text-slate-500 shrink-0" />
      </button>

      {open ? (
        <div
          className="mt-2 rounded-lg bg-slate-900 border border-slate-700/60 shadow-xl p-2 space-y-3"
          data-testid="context-switcher-popover"
        >
          <Section
            label="Organization"
            items={orgs.map((o) => ({
              key: o.id,
              label: o.name,
              href: `/${o.slug}/${slugs.userSlug}/${slugs.projectSlug}${suffix}`,
              active: o.slug === slugs.orgSlug,
            }))}
            onPick={() => setOpen(false)}
          />
          <Section
            label="User"
            items={users.map((u) => ({
              key: u.id,
              label: u.name,
              href: `/${slugs.orgSlug}/${u.slug}/${slugs.projectSlug}${suffix}`,
              active: u.slug === slugs.userSlug,
            }))}
            onPick={() => setOpen(false)}
          />
          <Section
            label="Project"
            items={projects.map((p) => ({
              key: p.id,
              label: p.name,
              href: `/${slugs.orgSlug}/${slugs.userSlug}/${p.slug}${suffix}`,
              active: p.slug === slugs.projectSlug,
            }))}
            onPick={() => setOpen(false)}
            // Hint to operators that the projects index lives under the
            // current user — link to that index for create flows etc.
            footerHref={`/${slugs.orgSlug}/${slugs.userSlug}`}
            footerLabel="View all projects →"
          />
        </div>
      ) : null}
    </div>
  );
}

type SectionItem = {
  key: string;
  label: string;
  href: string;
  active: boolean;
};

function Section({
  label,
  items,
  onPick,
  footerHref,
  footerLabel,
}: {
  label: string;
  items: SectionItem[];
  onPick: () => void;
  footerHref?: string;
  footerLabel?: string;
}) {
  return (
    <div>
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[1.5px] text-slate-500">
        {label}
      </div>
      <ul className="space-y-0.5">
        {items.length === 0 ? (
          <li className="px-2 py-1 text-xs text-slate-600 italic">none</li>
        ) : (
          items.map((it) => (
            <li key={it.key}>
              <Link
                href={it.href}
                onClick={onPick}
                className={`block px-2 py-1 rounded text-xs transition-colors ${
                  it.active
                    ? 'bg-electric-violet/15 text-soft-violet font-medium'
                    : 'text-slate-300 hover:bg-white/[0.04]'
                }`}
              >
                {it.label}
              </Link>
            </li>
          ))
        )}
      </ul>
      {footerHref && footerLabel ? (
        <Link
          href={footerHref}
          onClick={onPick}
          className="block mt-1 px-2 py-1 text-[11px] text-slate-500 hover:text-slate-300"
        >
          {footerLabel}
        </Link>
      ) : null}
    </div>
  );
}
