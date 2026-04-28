// src/app/[org]/[user]/projects-index-client.tsx
'use client';

import { GitBranch } from 'lucide-react';
import Link from 'next/link';

type Props = {
  orgSlug: string;
  userSlug: string;
  orgName: string;
  userName: string;
  projects: {
    id: string;
    name: string;
    slug: string;
    repoUrl: string | null;
    defaultBranch: string;
  }[];
};

export function ProjectsIndexClient({
  orgSlug,
  userSlug,
  orgName,
  userName,
  projects,
}: Props) {
  return (
    <div className="min-h-screen bg-linear-to-b from-slate-950 to-[#0B0014] p-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8">
          <p className="text-xs uppercase tracking-[1.5px] text-slate-500">
            {orgName}
          </p>
          <h1 className="text-2xl font-bold text-white mt-1">
            {userName} · Projects
          </h1>
          <p className="text-sm text-slate-400 mt-2">
            {projects.length === 0
              ? 'No projects yet.'
              : `${projects.length} project${projects.length === 1 ? '' : 's'}.`}
          </p>
        </header>

        {projects.length === 0 ? (
          <div className="rounded-xl border border-slate-700/40 bg-slate-900/60 p-8 text-center text-sm text-slate-400">
            This user has no projects in {orgName} yet. Create one in Settings →
            Projects after picking an existing project context.
          </div>
        ) : (
          <ul
            data-testid="projects-index-grid"
            className="grid grid-cols-1 md:grid-cols-2 gap-4"
          >
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/${orgSlug}/${userSlug}/${p.slug}`}
                  data-testid={`project-card-${p.slug}`}
                  className="block rounded-xl border border-slate-700/40 bg-slate-900/60 p-5 hover:border-electric-violet/50 hover:bg-slate-900 transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-semibold text-white truncate">
                        {p.name}
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5 font-mono truncate">
                        {p.slug}
                      </p>
                    </div>
                    <GitBranch
                      size={16}
                      className="text-slate-600 shrink-0 mt-1"
                    />
                  </div>
                  {p.repoUrl ? (
                    <p className="mt-3 text-xs text-slate-400 truncate">
                      {p.repoUrl}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-slate-600 font-mono">
                    branch · {p.defaultBranch}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
