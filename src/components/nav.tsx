'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  CircleDot,
  GitBranch,
  BarChart3,
  Workflow,
  Users,
  Sparkles,
  Route,
  Server,
  Terminal,
} from 'lucide-react';

function useBasePath() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);
  return segments.length >= 3 ? `/${segments[0]}/${segments[1]}/${segments[2]}` : '/';
}

export function Nav() {
  const pathname = usePathname();
  const basePath = useBasePath();

  const mainLinks = [
    { href: basePath, label: 'Dashboard', icon: LayoutDashboard },
    { href: `${basePath}/issues`, label: 'Issues', icon: CircleDot },
    { href: `${basePath}/pipelines`, label: 'Pipelines', icon: GitBranch },
    { href: `${basePath}/kpis`, label: 'KPIs', icon: BarChart3 },
  ];

  const settingsLinks = [
    { href: `${basePath}/settings`, label: 'Pipelines', exact: true, icon: Workflow },
    { href: `${basePath}/settings/personas`, label: 'Personas', icon: Users },
    { href: `${basePath}/settings/skills`, label: 'Skills', icon: Sparkles },
    { href: `${basePath}/settings/drivers`, label: 'Drivers', icon: Terminal },
    { href: `${basePath}/settings/routing`, label: 'Routing', icon: Route },
    { href: `${basePath}/settings/providers`, label: 'Providers', icon: Server },
  ];

  return (
    <nav className="w-[250px] shrink-0 h-full flex flex-col bg-linear-to-b from-slate-900 to-[#0B0014] border-r border-slate-700/30 shadow-[4px_0_24px_rgba(0,0,0,0.3)] relative z-10">
      {/* Wordmark */}
      <div className="px-6 pt-5 pb-2">
        <h1 className="text-xl font-extrabold tracking-tight">
          <span className="text-soft-violet">flux</span>
          <span className="text-white">aOS</span>
        </h1>
        <p className="text-[11px] text-slate-500 mt-0.5">AI Orchestration OS</p>
      </div>

      <div className="mx-4 my-3 h-px bg-slate-700/30" />

      {/* Main nav */}
      <ul className="flex-1 px-3 space-y-0.5">
        {mainLinks.map((link) => {
          const isActive =
            link.href === basePath
              ? pathname === basePath
              : pathname.startsWith(link.href);
          const Icon = link.icon;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] text-sm transition-all ${
                  isActive
                    ? 'bg-linear-to-r from-electric-violet to-royal-violet text-white font-semibold shadow-[0_4px_16px_rgba(124,58,237,0.35)]'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-300'
                }`}
              >
                <Icon size={18} className={isActive ? 'opacity-90' : 'opacity-50'} />
                {link.label}
              </Link>
            </li>
          );
        })}

        {/* Settings section */}
        <li className="pt-6">
          <span className="block px-3.5 pb-2 text-[10px] font-semibold uppercase tracking-[1.5px] text-slate-600">
            Settings
          </span>
          <ul className="space-y-0.5">
            {settingsLinks.map((link) => {
              const isActive = 'exact' in link && link.exact
                ? pathname === link.href
                : pathname.startsWith(link.href);
              const Icon = link.icon;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`flex items-center gap-3 px-3.5 py-2 pl-5 rounded-[10px] text-[13px] transition-all ${
                      isActive
                        ? 'bg-linear-to-r from-electric-violet to-royal-violet text-white font-medium shadow-[0_4px_16px_rgba(124,58,237,0.35)]'
                        : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-400'
                    }`}
                  >
                    <Icon size={16} className={isActive ? 'opacity-80' : 'opacity-40'} />
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </li>
      </ul>

      {/* Version */}
      <div className="px-6 py-4">
        <span className="text-[11px] font-mono text-slate-700">v0.1.0-alpha</span>
      </div>
    </nav>
  );
}
