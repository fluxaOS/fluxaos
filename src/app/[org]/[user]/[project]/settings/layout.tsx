// src/app/[org]/[user]/[project]/settings/layout.tsx
'use client';

import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import type { ReactNode } from 'react';

type TabSpec = {
  /** URL-suffix relative to /settings (empty string = /settings itself) */
  slug: string;
  label: string;
};

const TABS: readonly TabSpec[] = [
  { slug: '', label: 'Pipelines' },
  { slug: 'projects', label: 'Projects' },
  { slug: 'skills', label: 'Skills' },
  { slug: 'drivers', label: 'Drivers' },
  { slug: 'providers', label: 'Providers' },
  { slug: 'routing', label: 'Routing' },
  { slug: 'personas', label: 'Personas' },
];

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useParams();
  const base = `/${params.org}/${params.user}/${params.project}/settings`;

  return (
    <div className="space-y-6">
      <nav className="flex gap-1 border-b border-slate-700/40">
        {TABS.map((t) => {
          const href = t.slug ? `${base}/${t.slug}` : base;
          // Active logic: exact match for root tab (Pipelines), prefix for the rest.
          const isActive = t.slug
            ? pathname.startsWith(`${base}/${t.slug}`)
            : pathname === base;
          return (
            <Link
              key={t.slug || 'root'}
              href={href}
              className={[
                'px-4 py-2 text-sm font-medium rounded-t-lg transition-colors',
                isActive
                  ? 'bg-slate-800/60 text-white border-b-2 border-electric-violet'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/30',
              ].join(' ')}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <div>{children}</div>
    </div>
  );
}
