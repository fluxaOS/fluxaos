import { LiveRun } from './live-run';
import { links } from '@/lib/links';

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* ambient gradient */}
      <div
        className="absolute inset-0 pointer-events-none z-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(124,58,237,0.25) 0%, rgba(45,27,105,0.08) 40%, transparent 70%)',
        }}
      />
      <div
        className="flx-grid-bg absolute inset-0 opacity-40 z-0"
        style={{
          maskImage:
            'radial-gradient(ellipse 60% 40% at 50% 30%, black, transparent)',
          WebkitMaskImage:
            'radial-gradient(ellipse 60% 40% at 50% 30%, black, transparent)',
        }}
      />

      <div className="relative max-w-[1180px] mx-auto px-8 pt-22 pb-24 grid lg:grid-cols-[1fr_1.05fr] gap-16 items-center">
        <div>
          <div className="inline-flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full border border-white/[0.12] bg-white/[0.02] text-xs text-[var(--muted)] mb-7">
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full bg-[rgba(124,58,237,0.18)] text-pale-violet">
              v0.9
            </span>
            Now with persona inheritance →
          </div>
          <h1 className="text-5xl lg:text-[56px] leading-[1.02] tracking-[-0.03em] font-semibold text-white m-0">
            <span className="text-white">Run AI pipelines</span>
            <br />
            <span className="text-soft-violet">
              the way you designed them.
            </span>
          </h1>
          <p className="text-lg leading-[1.55] text-[var(--muted)] mt-6 max-w-[480px]">
            Stage-by-stage control, configurable quality gates between every
            stage, routing across any provider. Self-hosted and open source.
          </p>
          {/* ICP statement */}
          <div className="flx-mono mt-5 inline-flex items-center gap-2.5 text-soft-violet" style={{ letterSpacing: '0.16em' }}>
            <span className="w-1 h-1 rounded-full bg-electric-violet" />
            BUILT FOR ENGINEERING TEAMS RUNNING AUTONOMOUS CODING AGENTS
          </div>
          <div className="flex gap-3 mt-9">
            <a
              href={links.gettingStarted}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-electric-violet px-5 py-3 text-sm font-medium text-white hover:shadow-[0_0_0_1px_rgba(124,58,237,0.5),0_8px_32px_-8px_rgba(124,58,237,0.6)] transition-shadow"
            >
              Get started →
            </a>
            <a
              href={links.docs}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-lg border border-white/[0.12] px-5 py-3 text-sm font-medium text-[#cfcdda] hover:border-white/25 hover:text-white transition-colors"
            >
              Read the docs
            </a>
          </div>
          {/* social-proof line */}
          <div className="mt-9 pt-5 border-t border-white/[0.07] flex items-center gap-3.5 flex-wrap text-[13px] text-[var(--muted)]">
            <a
              href={links.github}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[#cfcdda] px-3 py-1.5 border border-white/[0.12] rounded-full font-mono text-xs hover:border-white/25 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0a8 8 0 0 0-2.5 15.6c.4.1.6-.2.6-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.4.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-4 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.5.8 1.2.8 2.1 0 3.1-1.9 3.8-3.6 4 .3.2.5.7.5 1.4v2c0 .2.2.5.6.4A8 8 0 0 0 8 0Z" />
              </svg>
              fluxaOS / fluxaos
            </a>
            <span className="text-[var(--dim)]">·</span>
            <span>AGPLv3 · self-hosted · no telemetry</span>
          </div>
        </div>
        <div className="relative">
          <LiveRun />
          {/* mini badge */}
          <div
            className="absolute -bottom-4 -left-4 px-3.5 py-2.5 rounded-[10px] border border-white/[0.12] bg-[#0e0c14] font-mono text-[11px] text-[var(--muted)] flex items-center gap-2.5"
            style={{ boxShadow: '0 12px 32px -12px rgba(0,0,0,0.6)' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#7ee787]" />
            3 stages · 2 providers · $0.0277
          </div>
        </div>
      </div>
    </section>
  );
}
