import Link from 'next/link';
import { links } from '@/lib/links';

const COLS: { title: string; rows: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: 'Product',
    rows: [
      { label: 'Pipelines', href: links.pipelinesDoc, external: true },
      { label: 'Gates', href: links.gatesDoc, external: true },
      { label: 'Personas', href: links.personasDoc, external: true },
      { label: 'Routing', href: links.routingDoc, external: true },
    ],
  },
  {
    title: 'Resources',
    rows: [
      { label: 'Docs', href: links.docs, external: true },
      { label: 'Changelog', href: links.changelog, external: true },
      { label: 'Releases', href: links.releases, external: true },
    ],
  },
  {
    title: 'Company',
    rows: [
      { label: 'GitHub', href: links.github, external: true },
      { label: 'Issues', href: links.issues, external: true },
    ],
  },
  {
    title: 'Connect',
    rows: [
      { label: 'GitHub', href: links.github, external: true },
      { label: 'Discussions', href: 'https://github.com/fluxaOS/fluxaos/discussions', external: true },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer
      className="relative overflow-hidden border-t border-white/[0.07] pt-16"
      style={{ background: '#06050d' }}
    >
      {/* Light beams from bottom */}
      <div
        aria-hidden="true"
        className="absolute left-0 right-0 pointer-events-none"
        style={{
          bottom: -40,
          height: 460,
          background: [
            'radial-gradient(ellipse 24% 90% at 50% 100%, rgba(167,139,250,0.55), transparent 70%)',
            'radial-gradient(ellipse 18% 80% at 22% 100%, rgba(124,58,237,0.32), transparent 75%)',
            'radial-gradient(ellipse 18% 80% at 78% 100%, rgba(124,58,237,0.32), transparent 75%)',
            'radial-gradient(ellipse 14% 70% at 5% 100%, rgba(124,58,237,0.18), transparent 80%)',
            'radial-gradient(ellipse 14% 70% at 95% 100%, rgba(124,58,237,0.18), transparent 80%)',
          ].join(', '),
        }}
      />
      {/* Top fade */}
      <div
        aria-hidden="true"
        className="absolute left-0 right-0 top-0 h-30 pointer-events-none"
        style={{
          background: 'linear-gradient(180deg, #06050d, transparent)',
        }}
      />

      <div className="max-w-[1180px] mx-auto px-8 relative">
        <div className="grid grid-cols-2 md:grid-cols-[1.4fr_repeat(4,1fr)] gap-8">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <Link
              href="/"
              className="flex items-center gap-2 text-lg font-semibold"
            >
              <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
                <path
                  d="M6 6 L26 6 L20 16 L26 26 L6 26 L12 16 Z"
                  fill="var(--electric-violet)"
                />
              </svg>
              <span>
                <span className="text-electric-violet">flux</span>
                <span className="text-white">aOS</span>
              </span>
            </Link>
            <p
              className="text-[13px] mt-3 max-w-[220px] leading-[1.5]"
              style={{ color: 'var(--muted)' }}
            >
              An OS for AI workflows.
              <br />
              Built to keep you in flow state.
            </p>
            <div className="flex gap-1 mt-5">
              <a
                href={links.github}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                className="w-7 h-7 inline-flex items-center justify-center rounded transition-colors"
                style={{ color: 'var(--muted)' }}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 0a8 8 0 0 0-2.5 15.6c.4.1.6-.2.6-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.4.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.5.8 1.2.8 2.1 0 3.1-1.9 3.8-3.6 4 .3.2.5.7.5 1.4v2c0 .2.2.5.6.4A8 8 0 0 0 8 0Z" />
                </svg>
              </a>
            </div>
          </div>

          {/* Link columns */}
          {COLS.map((col) => (
            <div key={col.title}>
              <h4 className="flx-mono mb-4" style={{ color: '#cfcdda' }}>
                {col.title}
              </h4>
              <ul className="flex flex-col gap-2.5 list-none p-0 m-0">
                {col.rows.map((r) => (
                  <li key={r.label}>
                    <a
                      href={r.href}
                      target={r.external ? '_blank' : undefined}
                      rel={r.external ? 'noopener noreferrer' : undefined}
                      className="text-[13px] hover:text-white transition-colors"
                      style={{ color: 'var(--muted)' }}
                    >
                      {r.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Baseline */}
        <div className="mt-16 pt-6 pb-8 border-t border-white/[0.07] flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-[12px]">
          <div style={{ color: 'var(--dim)' }}>
            AGPLv3 Licensed · © {new Date().getFullYear()} fluxaOS
          </div>
          <div className="flx-mono" style={{ color: 'var(--dim)' }}>
            self-hosted · no telemetry
          </div>
        </div>
      </div>
    </footer>
  );
}
