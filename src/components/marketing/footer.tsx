import Link from 'next/link';

export function MarketingFooter() {
  return (
    <footer className="border-t border-white/5 bg-void">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col items-start justify-between gap-8 md:flex-row md:items-center">
          <div>
            <Link href="/" className="text-lg font-bold tracking-tight">
              <span className="text-electric-violet">flux</span>
              <span className="text-white">aOS</span>
            </Link>
            <p className="mt-2 text-sm text-slate-500">
              An OS for AI workflows
            </p>
          </div>

          <nav className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-slate-400">
            <a
              href="https://github.com/fluxaOS/fluxaos"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-white"
            >
              GitHub
            </a>
            <a
              href="https://github.com/fluxaOS/fluxaos#getting-started"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-white"
            >
              Documentation
            </a>
            <a
              href="https://github.com/fluxaOS/fluxaos/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-white"
            >
              Issues
            </a>
          </nav>
        </div>

        <div className="mt-8 border-t border-white/5 pt-8 text-xs text-slate-600">
          <p>
            AGPLv3 Licensed &middot; &copy; {new Date().getFullYear()} fluxaOS
          </p>
        </div>
      </div>
    </footer>
  );
}
