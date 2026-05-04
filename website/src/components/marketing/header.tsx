import Link from 'next/link';
import { links } from '@/lib/links';
import { GitHubStarBadge } from '@/lib/use-github-stars';

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.07] bg-[rgba(11,10,16,0.7)] backdrop-blur-md">
      <div className="mx-auto max-w-[1180px] px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="text-base font-semibold tracking-tight"
          >
            <span className="text-electric-violet">flux</span>
            <span className="text-white">aOS</span>
          </Link>
          <nav className="hidden md:flex gap-6">
            <a
              href="#features"
              className="text-[13px] text-[var(--muted)] hover:text-white transition-colors"
            >
              Product
            </a>
            <a
              href={links.docs}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-[var(--muted)] hover:text-white transition-colors"
            >
              Docs
            </a>
            <a
              href={links.pipelinesDoc}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-[var(--muted)] hover:text-white transition-colors"
            >
              Pipelines
            </a>
            <a
              href={links.changelog}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-[var(--muted)] hover:text-white transition-colors"
            >
              Changelog
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <GitHubStarBadge />
          <a
            href={links.github}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline text-[13px] text-[var(--muted)] hover:text-white transition-colors"
          >
            GitHub ↗
          </a>
          <a
            href={links.gettingStarted}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-electric-violet px-3.5 py-2 text-[13px] font-medium text-white hover:shadow-[0_0_0_1px_rgba(124,58,237,0.5),0_8px_32px_-8px_rgba(124,58,237,0.6)] transition-shadow"
          >
            Get started
          </a>
        </div>
      </div>
    </header>
  );
}
