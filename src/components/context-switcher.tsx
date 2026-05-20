// src/components/context-switcher.tsx
// FLX-239: surface the current project from the /p/{projectUuid} URL and
// switch projects while preserving the current project-relative route.
'use client';

import { ChevronsUpDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  projectPath,
  projectPathSuffix,
  projectUuidFromPathname,
} from '@/lib/project-url';
import { trpc } from '@/lib/trpc/client';

export function ContextSwitcher() {
  const pathname = usePathname();
  const projectUuid = projectUuidFromPathname(pathname);
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

  const currentProjectQuery = trpc.project.getById.useQuery(
    { id: projectUuid ?? '' },
    { enabled: Boolean(projectUuid) }
  );
  const currentProject = currentProjectQuery.data ?? null;

  const projectsQuery = trpc.project.listByOrg.useQuery(
    { orgId: currentProject?.orgId ?? '' },
    { enabled: Boolean(currentProject?.orgId) }
  );
  const projects = projectsQuery.data ?? [];

  if (!projectUuid) return null;

  const suffix = projectPathSuffix(pathname);

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
          <div className="text-slate-500 truncate">Current project</div>
          <div className="text-slate-200 font-semibold truncate">
            {currentProject?.name ?? projectUuid}
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
            label="Project"
            items={projects.map((p) => ({
              key: p.id,
              label: p.name,
              href: projectPath(p.id, suffix),
              active: p.id === projectUuid,
            }))}
            onPick={() => setOpen(false)}
            footerHref={projectPath(projectUuid, '/settings/projects')}
            footerLabel="Manage projects ->"
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
