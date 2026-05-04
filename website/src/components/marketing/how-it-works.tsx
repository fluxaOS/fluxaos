'use client';

import { useEffect, useState } from 'react';

type ConfigToken =
  | ['key' | 'val' | 'op', string]
  | ['nl']
  | ['nl', number]
  | ['ind', string];

type ConfigPreview = {
  kind: 'config';
  chrome: string;
  lines: ConfigToken[];
};

type OrchestratePreview = {
  kind: 'orchestrate';
  chrome: string;
  board: { name: string; status: 'done' | 'running' | 'queued'; persona: string; ms: string }[];
};

type ObservePreview = {
  kind: 'observe';
  chrome: string;
  metrics: { label: string; val: string; delta: string; good: boolean }[];
};

type Preview = ConfigPreview | OrchestratePreview | ObservePreview;

type Step = {
  num: string;
  label: string;
  title: string;
  body: string;
  preview: Preview;
};

const STEPS: Step[] = [
  {
    num: '01',
    label: 'Configure',
    title: 'Write it once, in YAML.',
    body: 'Define pipelines, personas, skills, and routing rules. Stored in the database — no config files to sync across machines.',
    preview: {
      kind: 'config',
      chrome: 'config / pipelines / ship-feature.yaml',
      lines: [
        ['key', 'pipeline'], ['op', ': '], ['val', 'ship-feature'], ['nl'],
        ['key', 'stages'], ['op', ': '], ['val', '[triage, plan, impl, review, ship]'], ['nl'],
        ['key', 'gates'], ['op', ':'], ['nl'],
        ['ind', '  '], ['key', 'after'], ['op', ': '], ['val', '[plan, impl]'], ['nl'],
        ['ind', '  '], ['key', 'rule'], ['op', ': '], ['val', 'budget < $0.50'], ['nl', 2],
        ['key', 'personas'], ['op', ':'], ['nl'],
        ['ind', '  '], ['key', 'plan'], ['op', ': '], ['val', 'architect'], ['nl'],
        ['ind', '  '], ['key', 'impl'], ['op', ': '], ['val', 'engineer'], ['nl'],
        ['ind', '  '], ['key', 'review'], ['op', ': '], ['val', 'reviewer'],
      ],
    },
  },
  {
    num: '02',
    label: 'Orchestrate',
    title: 'fluxaOS runs the loop.',
    body: 'Routes work to the right provider, materializes skills to the workspace, executes stages, evaluates gates between them.',
    preview: {
      kind: 'orchestrate',
      chrome: 'run · pipeline=ship-feature · #38219 · LIVE',
      board: [
        { name: 'triage', status: 'done', persona: 'router', ms: '0.4s' },
        { name: 'plan', status: 'done', persona: 'architect', ms: '2.1s' },
        { name: 'impl', status: 'running', persona: 'engineer', ms: '4.8s' },
        { name: 'review', status: 'queued', persona: 'reviewer', ms: '—' },
        { name: 'ship', status: 'queued', persona: 'shipper', ms: '—' },
      ],
    },
  },
  {
    num: '03',
    label: 'Observe',
    title: 'Watch every token, live.',
    body: 'Stream runs in real-time. Track costs per provider, model, project. Iterate on configuration with the data in front of you.',
    preview: {
      kind: 'observe',
      chrome: 'metrics · last 60s',
      metrics: [
        { label: 'tokens', val: '12.4k', delta: '+8%', good: true },
        { label: 'cost', val: '$0.34', delta: '+2%', good: true },
        { label: 'latency', val: '420ms', delta: '-5%', good: true },
        { label: 'errors', val: '0', delta: '↘', good: true },
      ],
    },
  },
];

function colorByStatus(s: 'done' | 'running' | 'queued') {
  return s === 'done'
    ? '#7ee787'
    : s === 'running'
    ? 'var(--soft-violet)'
    : 'rgba(255,255,255,0.3)';
}

function ConfigPane({ p }: { p: ConfigPreview }) {
  const tokenColor = (t: string) =>
    t === 'key'
      ? 'var(--soft-violet)'
      : t === 'val'
      ? '#cfcdda'
      : t === 'op'
      ? 'var(--muted)'
      : '#cfcdda';

  // Render tokens into lines.
  const out: React.ReactElement[] = [];
  let buf: React.ReactElement[] = [];
  let lineKey = 0;
  const flush = () => {
    out.push(
      <div key={`l${lineKey++}`} className="flex gap-0">
        <span
          className="text-[var(--dim)] inline-block text-right"
          style={{ width: 28, marginRight: 14 }}
        >
          {lineKey}
        </span>
        <span>{buf}</span>
      </div>
    );
    buf = [];
  };
  p.lines.forEach((tok, i) => {
    if (tok[0] === 'nl') {
      flush();
      if (tok[1] === 2) flush();
    } else if (tok[0] === 'ind') {
      buf.push(
        <span key={i} style={{ whiteSpace: 'pre' }}>
          {tok[1]}
        </span>
      );
    } else {
      buf.push(
        <span key={i} style={{ color: tokenColor(tok[0]) }}>
          {tok[1]}
        </span>
      );
    }
  });
  if (buf.length) flush();

  return (
    <div
      className="font-mono px-6 py-6"
      style={{ fontSize: 13, lineHeight: 1.85 }}
    >
      {out}
    </div>
  );
}

function OrchestratePane({ p }: { p: OrchestratePreview }) {
  return (
    <div className="p-7">
      <div className="flex flex-col gap-2.5">
        {p.board.map((s, i) => {
          const c = colorByStatus(s.status);
          const running = s.status === 'running';
          return (
            <div
              key={i}
              className="grid grid-cols-[24px_1fr_1fr_60px] gap-4 items-center px-4 py-3 rounded-lg font-mono text-xs"
              style={{
                background: running
                  ? 'rgba(167,139,250,0.08)'
                  : 'transparent',
                border: `1px solid ${
                  running ? 'var(--electric-violet)' : 'var(--line)'
                }`,
              }}
            >
              <div className="relative w-3 h-3">
                <span
                  className="absolute inset-0 rounded-full"
                  style={{ background: c }}
                />
                {running && (
                  <span
                    className="absolute -inset-1 rounded-full border border-electric-violet"
                    style={{
                      animation: 'flx-pulse-ring 1.6s ease-out infinite',
                    }}
                  />
                )}
              </div>
              <span
                style={{
                  color: running ? 'white' : '#cfcdda',
                  fontWeight: running ? 600 : 400,
                }}
              >
                {s.name}
              </span>
              <span style={{ color: 'var(--muted)' }}>
                persona = {s.persona}
              </span>
              <span style={{ color: c, textAlign: 'right' }}>{s.ms}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ObservePane({ p }: { p: ObservePreview }) {
  return (
    <div className="p-7">
      <div className="grid grid-cols-2 gap-3">
        {p.metrics.map((m, i) => (
          <div
            key={i}
            className="px-5 py-5 rounded-[10px] relative overflow-hidden"
            style={{
              border: '1px solid var(--line-strong)',
              background: '#0a0810',
            }}
          >
            <div
              className="flx-mono"
              style={{
                fontSize: 10,
                letterSpacing: '0.16em',
              }}
            >
              {m.label}
            </div>
            <div
              className="font-mono font-semibold text-white mt-2"
              style={{ fontSize: 28, letterSpacing: '-0.01em' }}
            >
              {m.val}
            </div>
            <div
              className="font-mono text-[11px] mt-1"
              style={{ color: m.good ? '#7ee787' : '#f0b429' }}
            >
              {m.delta}
            </div>
            <svg
              viewBox="0 0 120 24"
              width="100%"
              height="20"
              className="mt-2.5 block"
            >
              <polyline
                points="0,18 12,14 24,16 36,8 48,12 60,6 72,10 84,4 96,8 108,3 120,5"
                fill="none"
                stroke="var(--electric-violet)"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HowItWorks() {
  const [active, setActive] = useState(1);
  const [paused, setPaused] = useState(false);
  const cur = STEPS[active];

  useEffect(() => {
    if (paused) return;
    const id = setInterval(
      () => setActive((a) => (a + 1) % STEPS.length),
      4500
    );
    return () => clearInterval(id);
  }, [paused]);

  const renderPreview = () => {
    if (cur.preview.kind === 'config') return <ConfigPane p={cur.preview} />;
    if (cur.preview.kind === 'orchestrate')
      return <OrchestratePane p={cur.preview} />;
    return <ObservePane p={cur.preview} />;
  };

  return (
    <section
      className="py-30 px-8 border-t border-white/[0.07]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="max-w-[1180px] mx-auto">
        <div className="mb-14">
          <div className="flx-mono mb-4 text-soft-violet">{'// how it works'}</div>
          <h2 className="text-[40px] font-semibold tracking-[-0.025em] text-white m-0 leading-[1.1]">
            Three steps from config to insight.
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-10 items-stretch">
          {/* LEFT — tab rail */}
          <div className="flex flex-col gap-2">
            {STEPS.map((s, i) => {
              const isActive = i === active;
              return (
                <button
                  key={s.num}
                  onClick={() => setActive(i)}
                  className="text-left px-5 py-5 rounded-xl cursor-pointer transition-all duration-200 relative"
                  style={{
                    background: isActive
                      ? 'linear-gradient(180deg, #14101e 0%, #0c0a14 100%)'
                      : 'transparent',
                    border: `1px solid ${
                      isActive ? 'var(--electric-violet)' : 'var(--line)'
                    }`,
                    boxShadow: isActive
                      ? '0 0 0 1px rgba(124,58,237,0.2), 0 16px 40px -20px rgba(124,58,237,0.5)'
                      : 'none',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="flx-mono"
                      style={{
                        fontSize: 11,
                        letterSpacing: '0.14em',
                        color: isActive ? 'var(--soft-violet)' : 'var(--muted)',
                      }}
                    >
                      {s.num}
                    </span>
                    <h3
                      className="m-0 text-[17px] font-semibold"
                      style={{
                        letterSpacing: '-0.01em',
                        color: isActive ? 'white' : '#cfcdda',
                      }}
                    >
                      {s.label}
                    </h3>
                  </div>
                  {isActive && (
                    <p
                      className="text-[13.5px] leading-[1.55] mt-3 mb-0"
                      style={{ color: 'var(--muted)' }}
                    >
                      {s.body}
                    </p>
                  )}
                </button>
              );
            })}
            <div
              className="mt-3 px-4 py-3.5 rounded-lg font-mono text-[11px] flex items-center gap-2.5"
              style={{
                border: '1px dashed var(--line)',
                color: 'var(--dim)',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: paused ? 'var(--muted)' : '#7ee787',
                }}
              />
              {paused ? 'paused — hover off to resume' : 'auto-advancing · hover to pause'}
            </div>
          </div>

          {/* RIGHT — preview */}
          <div
            className="rounded-xl overflow-hidden flex flex-col min-h-[360px] border border-white/[0.12]"
            style={{
              background: 'linear-gradient(180deg, #0e0c14 0%, #0a0810 100%)',
              boxShadow:
                '0 30px 80px -30px rgba(124,58,237,0.4), 0 0 0 1px rgba(124,58,237,0.05)',
            }}
          >
            <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-white/[0.07] bg-white/[0.02]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#3a3845]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#3a3845]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#3a3845]" />
              <div className="flex-1 text-center font-mono text-[11px] text-[var(--muted)]">
                {cur.preview.chrome}
              </div>
              <span
                className="flx-mono text-soft-violet"
                style={{ fontSize: 10, letterSpacing: '0.14em' }}
              >
                STEP {cur.num}
              </span>
            </div>
            <div className="flex-1">{renderPreview()}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
