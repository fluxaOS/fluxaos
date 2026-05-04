'use client';

import { useEffect, useState } from 'react';

type Line = {
  t: string;
  s: 'gate' | 'stage' | 'tok' | 'tool';
  text: string;
  ok?: boolean;
  warn?: boolean;
};

const LINES: Line[] = [
  { t: '14:02:11', s: 'gate', text: 'evaluate(triage) → pass', ok: true },
  { t: '14:02:11', s: 'stage', text: 'enter(plan) · persona=architect · provider=anthropic' },
  { t: '14:02:13', s: 'tok', text: 'streaming · 412 tok · $0.0061' },
  { t: '14:02:14', s: 'tool', text: 'fs.read(./src) · 38 files' },
  { t: '14:02:18', s: 'gate', text: 'evaluate(plan) → human-review', warn: true },
  { t: '14:02:42', s: 'gate', text: 'approved by @maya', ok: true },
  { t: '14:02:42', s: 'stage', text: 'enter(implement) · persona=engineer · provider=anthropic' },
  { t: '14:02:48', s: 'tok', text: 'streaming · 1,284 tok · $0.0192' },
  { t: '14:02:51', s: 'tool', text: 'fs.write(src/lib/pipeline.ts)' },
  { t: '14:02:54', s: 'gate', text: 'evaluate(implement) → pass', ok: true },
  { t: '14:02:54', s: 'stage', text: 'enter(review) · persona=reviewer · provider=openai' },
  { t: '14:02:58', s: 'tok', text: 'streaming · 643 tok · $0.0024' },
];

function tagColor(s: Line['s'], ok?: boolean, warn?: boolean) {
  if (ok) return '#7ee787';
  if (warn) return '#f0b429';
  if (s === 'stage') return 'var(--soft-violet)';
  if (s === 'tok') return '#7aa2f7';
  if (s === 'tool') return '#c9a4ff';
  if (s === 'gate') return '#f0b429';
  return 'var(--muted)';
}

export function LiveRun() {
  const [n, setN] = useState(4);

  // Append next line on a stagger.
  useEffect(() => {
    if (n >= LINES.length) return;
    const id = setTimeout(() => setN(n + 1), 1100 + Math.random() * 600);
    return () => clearTimeout(id);
  }, [n]);

  // Loop back.
  useEffect(() => {
    if (n < LINES.length) return;
    const id = setTimeout(() => setN(4), 4000);
    return () => clearTimeout(id);
  }, [n]);

  return (
    <div
      className="rounded-xl overflow-hidden border border-white/[0.12]"
      style={{
        background: 'linear-gradient(180deg, #0e0c14 0%, #0a0810 100%)',
        boxShadow:
          '0 30px 80px -30px rgba(124,58,237,0.4), 0 0 0 1px rgba(124,58,237,0.08)',
      }}
    >
      {/* chrome */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-white/[0.07] bg-white/[0.02]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#3a3845]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#3a3845]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#3a3845]" />
        <div className="flex-1 text-center font-mono text-[11px] text-[var(--muted)]">
          run · pipeline=ship-feature · #38219
        </div>
        <span className="font-mono text-[10px] text-[#7ee787] px-2 py-0.5 rounded bg-[rgba(126,231,135,0.08)] inline-flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full bg-[#7ee787]"
            style={{ animation: 'flx-pulse 1.4s ease-in-out infinite' }}
          />
          LIVE
        </span>
      </div>
      {/* body */}
      <div
        className="font-mono px-4 py-4 min-h-[320px]"
        style={{ fontSize: 12.5, lineHeight: 1.7 }}
      >
        {LINES.slice(0, n).map((l, i) => (
          <div
            key={i}
            className="flex gap-3"
            style={{
              animation: i === n - 1 ? 'flx-slidein .3s ease' : 'none',
            }}
          >
            <span className="text-[var(--dim)] flex-shrink-0">{l.t}</span>
            <span
              className="w-[50px] flex-shrink-0"
              style={{ color: tagColor(l.s, l.ok, l.warn) }}
            >
              {l.ok ? '✓' : l.warn ? '◆' : '·'} {l.s}
            </span>
            <span
              style={{
                color: l.ok ? '#9eecaa' : l.warn ? '#f5c451' : '#cfcdda',
              }}
            >
              {l.text}
            </span>
          </div>
        ))}
        {n < LINES.length && <div className="flx-cursor h-4" />}
      </div>
    </div>
  );
}
