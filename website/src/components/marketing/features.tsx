'use client';

import { useState } from 'react';
import { GateCallout } from './gate-callout';
import { FEATURE_GRAPHICS } from './feature-graphics';
import { links } from '@/lib/links';

const FEATURES = [
  {
    key: 'pipeline',
    glyph: '01',
    title: 'Pipeline orchestration',
    body: 'Multi-stage pipelines with retries, sequential execution, and gates between stages. Define once, run everywhere.',
  },
  {
    key: 'routing',
    glyph: '02',
    title: 'Provider-agnostic routing',
    body: 'Anthropic, OpenAI, Ollama — route by config, not code. Fallback chains handle failures automatically.',
  },
  {
    key: 'gates',
    glyph: '03',
    title: 'Gate-controlled quality',
    body: 'Configurable quality gates between every stage. Auto-approve, hold for review, rework, or abort.',
  },
  {
    key: 'personas',
    glyph: '04',
    title: 'Configurable personas',
    body: 'Agent personalities, skills, routing rules. Scope globally or per-project — inherit, fork, override.',
  },
  {
    key: 'observability',
    glyph: '05',
    title: 'Real-time observability',
    body: 'Stream every stage live. Tokens, costs, success rates — event-sourced from the ground up.',
  },
  {
    key: 'selfHosted',
    glyph: '06',
    title: 'Self-hosted, open source',
    body: 'Docker Compose deployment. Your data, your infrastructure. AGPLv3 — inspect, fork, contribute.',
  },
];

function FeatureCard({ f }: { f: (typeof FEATURES)[number] }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="px-7 py-7 min-h-[320px] flex flex-col cursor-default transition-all duration-[250ms]"
      style={{
        background: hover
          ? 'linear-gradient(180deg, #14101e 0%, #0c0a14 100%)'
          : 'var(--background)',
      }}
    >
      <div
        className="h-[140px] mb-5 flex items-stretch overflow-hidden relative transition-colors duration-[250ms]"
        style={{
          color: hover ? 'var(--soft-violet)' : 'rgba(255,255,255,0.55)',
        }}
      >
        <div
          className="w-full h-full transition-transform duration-[350ms]"
          style={{ transform: hover ? 'scale(1.04)' : 'scale(1)' }}
        >
          {FEATURE_GRAPHICS[f.key]}
        </div>
      </div>
      <h3
        className="text-[17px] font-semibold m-0 transition-colors duration-200"
        style={{
          letterSpacing: '-0.01em',
          color: hover ? 'white' : '#e4e2eb',
        }}
      >
        {f.title}
      </h3>
      <p
        className="text-[13.5px] mt-2.5 leading-[1.6]"
        style={{ color: 'var(--muted)' }}
      >
        {f.body}
      </p>
      <div
        className="mt-auto pt-4 flex items-center justify-between transition-all duration-[250ms]"
        style={{
          opacity: hover ? 1 : 0,
          transform: hover ? 'translateY(0)' : 'translateY(4px)',
        }}
      >
        <span className="flx-mono text-soft-violet">learn more</span>
        <span className="text-soft-violet text-sm">→</span>
      </div>
    </div>
  );
}

export function Features() {
  return (
    <section id="features" className="py-30 px-8 pt-30 pb-15">
      <div className="max-w-[1180px] mx-auto">
        <div className="mb-14 flex items-end justify-between gap-12">
          <div className="max-w-[640px]">
            <div className="flx-mono mb-4 text-soft-violet">
              {'// capabilities'}
            </div>
            <h2 className="text-[40px] font-semibold tracking-[-0.025em] text-white m-0 leading-[1.1]">
              A config-driven engine
              <br />
              <span style={{ color: 'var(--muted)' }}>
                that puts the pieces together.
              </span>
            </h2>
          </div>
          <a
            href={links.docs}
            target="_blank"
            rel="noopener noreferrer"
            className="flx-mono text-soft-violet whitespace-nowrap pb-2 hover:text-pale-violet transition-colors"
          >
            view all docs ↗
          </a>
        </div>

        <GateCallout />

        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px border border-white/[0.07] rounded-2xl overflow-hidden"
          style={{ background: 'var(--line)' }}
        >
          {FEATURES.map((f) => (
            <FeatureCard key={f.key} f={f} />
          ))}
        </div>
      </div>
    </section>
  );
}
