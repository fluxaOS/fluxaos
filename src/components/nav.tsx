'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/issues', label: 'Issues' },
  { href: '/dashboard/pipelines', label: 'Pipelines' },
  { href: '/dashboard/settings', label: 'Settings' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="w-64 shrink-0 bg-sidebar border-r border-sidebar-border h-full flex flex-col">
      <div className="p-6 border-b border-sidebar-border">
        <h1 className="text-lg font-bold tracking-tight text-accent">
          fluxaOS
        </h1>
        <p className="text-xs text-muted mt-1">AI Orchestration OS</p>
      </div>
      <ul className="flex-1 p-3 space-y-1">
        {links.map((link) => {
          const isActive =
            link.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className={`block px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-accent/15 text-accent font-medium'
                    : 'text-muted hover:text-foreground hover:bg-white/5'
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
