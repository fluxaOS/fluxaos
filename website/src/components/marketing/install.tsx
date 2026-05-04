'use client';

import { useState } from 'react';
import { links } from '@/lib/links';

const CMD = `git clone https://github.com/fluxaOS/fluxaos.git
cd fluxaos
cp .env.example .env
docker compose up`;

export function Install() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(CMD).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section
      className="border-y border-white/[0.12] relative overflow-hidden"
      style={{ background: '#080612' }}
    >
      {/* Vertical AGPLv3 rail */}
      <div
        className="flx-mono absolute hidden lg:block"
        style={{
          right: 18,
          top: '50%',
          transform: 'translateY(-50%) rotate(90deg)',
          transformOrigin: 'center',
          color: 'var(--dim)',
          fontSize: 10,
          letterSpacing: '0.4em',
          whiteSpace: 'nowrap',
        }}
      >
        AGPLv3 · SELF-HOSTED · NO TELEMETRY
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[480px]">
        {/* LEFT — slab type */}
        <div
          className="px-12 lg:pl-20 lg:pr-12 py-22 border-b lg:border-b-0 lg:border-r border-white/[0.07] flex flex-col justify-between gap-10"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 0% 100%, rgba(124,58,237,0.18), transparent 60%)',
          }}
        >
          <div className="flx-mono text-soft-violet" style={{ letterSpacing: '0.2em' }}>
            04 / INSTALL
          </div>
          <div>
            <div
              className="font-mono text-electric-violet mb-6"
              style={{ fontSize: 140, lineHeight: 0.85, fontWeight: 200 }}
            >
              $_
            </div>
            <h2 className="text-5xl lg:text-[56px] font-semibold tracking-[-0.03em] text-white m-0 leading-[0.98]">
              Run it on
              <br />
              your own box.
            </h2>
            <p
              className="text-base mt-6 max-w-[380px] leading-[1.55]"
              style={{ color: 'var(--muted)' }}
            >
              Four commands. Docker Compose stack. Your data, your
              infrastructure.
            </p>
          </div>
          <div className="flex gap-3">
            <a
              href={links.github}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-electric-violet px-5 py-3 text-sm font-medium text-white hover:shadow-[0_0_0_1px_rgba(124,58,237,0.5),0_8px_32px_-8px_rgba(124,58,237,0.6)] transition-shadow"
            >
              ★ Star on GitHub
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
        </div>

        {/* RIGHT — terminal */}
        <div className="px-12 lg:pl-12 lg:pr-20 py-22 flex flex-col gap-5">
          <div
            className="flx-mono flex items-center gap-3"
            style={{ color: 'var(--dim)', fontSize: 10, letterSpacing: '0.15em' }}
          >
            <span>~/fluxaos</span>
            <span className="flex-1 h-px bg-white/[0.07]" />
            <button
              onClick={copy}
              className="bg-transparent border border-white/[0.12] px-2 py-1 rounded font-mono cursor-pointer transition-colors"
              style={{
                fontSize: 10,
                color: copied ? '#7ee787' : 'var(--muted)',
              }}
            >
              {copied ? '✓ copied' : 'copy'}
            </button>
          </div>
          <pre
            className="m-0 px-6 py-6 font-mono rounded-[10px] border border-white/[0.12]"
            style={{
              fontSize: 14,
              lineHeight: 1.85,
              color: '#cfcdda',
              background: '#0a0810',
            }}
          >
            <span style={{ color: 'var(--dim)' }}>$</span>{' '}
            <span style={{ color: '#cfcdda' }}>
              git clone https://github.com/fluxaOS/fluxaos.git
            </span>
            {'\n'}
            <span style={{ color: 'var(--dim)' }}>$</span>{' '}
            <span style={{ color: '#cfcdda' }}>cd fluxaos</span>
            {'\n'}
            <span style={{ color: 'var(--dim)' }}>$</span>{' '}
            <span style={{ color: '#cfcdda' }}>cp .env.example .env</span>
            {'\n'}
            <span style={{ color: 'var(--dim)' }}>$</span>{' '}
            <span style={{ color: 'var(--soft-violet)' }}>
              docker compose up
            </span>
            {'\n\n'}
            <span style={{ color: '#7ee787' }}>✓ web</span>{'     '}
            <span style={{ color: 'var(--dim)' }}>http://localhost:3000</span>
            {'\n'}
            <span style={{ color: '#7ee787' }}>✓ worker</span>{'  '}
            <span style={{ color: 'var(--dim)' }}>ready</span>
            {'\n'}
            <span style={{ color: '#7ee787' }}>✓ db</span>{'      '}
            <span style={{ color: 'var(--dim)' }}>postgres 16</span>
            {'\n'}
          </pre>
          <div
            className="flx-mono"
            style={{ color: 'var(--dim)', fontSize: 10, marginTop: 4 }}
          >
            requires: docker ≥ 24 · 4 GB RAM · 2 CPU
          </div>
        </div>
      </div>
    </section>
  );
}
