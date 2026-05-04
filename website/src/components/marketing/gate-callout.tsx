// The lead-differentiator block. Schematic of [stage]→GATE→[stage]→GATE→[stage]
// on the left, copy + 4 gate-action chips on the right. Sits above the
// feature grid as its own statement.

type StageStatus = 'pass' | 'rework' | 'running';
type GateVerdict = 'pass' | 'rework';
type ActionTone = 'approve' | 'hold' | 'rework' | 'abort';

function Stage({ label, status }: { label: string; status: StageStatus }) {
  const dotColor =
    status === 'pass'
      ? '#7ee787'
      : status === 'rework'
      ? '#f5a623'
      : 'var(--electric-violet)';
  const text =
    status === 'pass' ? 'passed' : status === 'rework' ? 'rework' : 'running';
  return (
    <div className="flex-1 border border-white/[0.12] rounded-lg px-3.5 py-3 bg-[#0c0a14] min-w-0">
      <div
        className="flx-mono"
        style={{
          color: 'var(--dim)',
          fontSize: 10,
          letterSpacing: '0.12em',
        }}
      >
        {label}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: dotColor }}
        />
        <span className="text-xs text-[#cfcdda] font-mono">{text}</span>
      </div>
    </div>
  );
}

function Gate({ verdict }: { verdict: GateVerdict }) {
  return (
    <div className="w-14 flex-shrink-0 flex flex-col items-center gap-1">
      <div
        className="flx-mono"
        style={{
          color: 'var(--dim)',
          fontSize: 9,
          letterSpacing: '0.14em',
        }}
      >
        GATE
      </div>
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
        <path
          d="M20 4 L36 20 L20 36 L4 20 Z"
          stroke="var(--electric-violet)"
          strokeWidth="1.4"
          fill={verdict === 'pass' ? 'rgba(124,58,237,0.18)' : 'transparent'}
        />
        {verdict === 'pass' && (
          <path
            d="M14 20 L18 24 L26 16"
            stroke="#7ee787"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )}
        {verdict === 'rework' && (
          <path
            d="M14 20 L26 20 M22 16 L26 20 L22 24"
            stroke="#f5a623"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )}
      </svg>
    </div>
  );
}

function Action({ label, tone }: { label: string; tone: ActionTone }) {
  const palette = {
    approve: {
      bg: 'rgba(126,231,135,0.08)',
      bd: 'rgba(126,231,135,0.35)',
      fg: '#7ee787',
    },
    hold: {
      bg: 'rgba(124,58,237,0.10)',
      bd: 'rgba(124,58,237,0.45)',
      fg: 'var(--soft-violet)',
    },
    rework: {
      bg: 'rgba(245,166,35,0.08)',
      bd: 'rgba(245,166,35,0.35)',
      fg: '#f5a623',
    },
    abort: {
      bg: 'rgba(239,83,80,0.08)',
      bd: 'rgba(239,83,80,0.35)',
      fg: '#ef5350',
    },
  }[tone];
  return (
    <div
      className="px-3 py-2 rounded-full font-mono text-[11px]"
      style={{
        background: palette.bg,
        border: `1px solid ${palette.bd}`,
        color: palette.fg,
        letterSpacing: '0.04em',
      }}
    >
      {label}
    </div>
  );
}

export function GateCallout() {
  return (
    <div
      className="relative mb-14 px-9 pl-10 py-9 rounded-2xl overflow-hidden border border-white/[0.12]"
      style={{
        background: 'linear-gradient(180deg, #0a0813 0%, #0b0915 100%)',
      }}
    >
      {/* left accent rail */}
      <div
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{
          background:
            'linear-gradient(180deg, var(--electric-violet), transparent 90%)',
        }}
      />
      {/* corner glow */}
      <div
        aria-hidden="true"
        className="absolute -right-[120px] -top-[120px] w-[360px] h-[360px] pointer-events-none"
        style={{
          background:
            'radial-gradient(circle, rgba(124,58,237,0.18), transparent 60%)',
        }}
      />

      <div className="relative grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-12 items-center">
        {/* LEFT — schematic */}
        <div>
          <div
            className="flx-mono"
            style={{
              color: 'var(--soft-violet)',
              fontSize: 11,
              letterSpacing: '0.14em',
              marginBottom: 14,
            }}
          >
            ── PIPELINE.YAML
          </div>
          <div className="flex items-stretch gap-1.5">
            <Stage label="01 PLAN" status="pass" />
            <Gate verdict="pass" />
            <Stage label="02 IMPLEMENT" status="pass" />
            <Gate verdict="rework" />
            <Stage label="03 TEST" status="running" />
          </div>
          <div
            className="mt-4 pt-3.5 border-t border-dashed border-white/[0.07] flex items-center gap-2.5 font-mono text-[11px]"
            style={{ color: 'var(--muted)' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-electric-violet" />
            gate.02 → triggered rework: lint failures (3), coverage 71% &lt; 80%
          </div>
        </div>

        {/* RIGHT — copy */}
        <div>
          <div
            className="flx-mono inline-flex items-center gap-2 px-2.5 py-1 rounded-full"
            style={{
              color: 'var(--electric-violet)',
              fontSize: 10,
              letterSpacing: '0.18em',
              border: '1px solid rgba(124,58,237,0.4)',
              background: 'rgba(124,58,237,0.08)',
            }}
          >
            ★ THE DIFFERENTIATOR
          </div>
          <h3 className="text-[28px] font-semibold tracking-[-0.02em] text-white mt-4 leading-[1.2]">
            The only pipeline engine with{' '}
            <span className="text-soft-violet">configurable quality gates</span>{' '}
            between every stage.
          </h3>
          <p
            className="text-[14.5px] leading-[1.6] mt-3.5 mb-5 max-w-[460px]"
            style={{ color: 'var(--muted)' }}
          >
            Auto-approve, hold for human review, trigger a rework pass, or
            abort — defined in config, not code. Devin won&apos;t let you.
            Continue can&apos;t write. fluxaOS does both.
          </p>
          <div className="flex flex-wrap gap-2">
            <Action label="auto-approve" tone="approve" />
            <Action label="hold for review" tone="hold" />
            <Action label="rework" tone="rework" />
            <Action label="abort" tone="abort" />
          </div>
        </div>
      </div>
    </div>
  );
}
