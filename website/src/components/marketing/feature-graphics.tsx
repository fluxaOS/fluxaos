// Symbolic feature graphics — no inline text labels. Pure form: rhythm,
// flow, gates, layers, pulse, layers.

import type { ReactNode } from 'react';

const SVG_PROPS = {
  width: '100%',
  height: '100%',
  viewBox: '0 0 200 140',
  preserveAspectRatio: 'xMidYMid meet' as const,
};

const ACCENT = '#a78bfa';
const FAINT = 'rgba(207,205,218,0.22)';
const SOFT = 'rgba(207,205,218,0.55)';

export const FEATURE_GRAPHICS: Record<string, ReactNode> = {
  // 01 PIPELINE — five stacked nodes on a vertical rail with the active
  // one filled and pulsing.
  pipeline: (
    <svg {...SVG_PROPS}>
      <line
        x1="40"
        y1="20"
        x2="40"
        y2="120"
        stroke={FAINT}
        strokeWidth="1"
        strokeDasharray="2 4"
      />
      {[0, 1, 2, 3, 4].map((i) => {
        const y = 22 + i * 22;
        const active = i === 2;
        const done = i < 2;
        return (
          <g key={i}>
            <circle
              cx="40"
              cy={y + 6}
              r={active ? 5 : 4}
              fill={done ? ACCENT : active ? ACCENT : '#0e0c14'}
              stroke={done || active ? ACCENT : FAINT}
              strokeWidth="1.4"
            />
            {active && (
              <circle
                cx="40"
                cy={y + 6}
                r="5"
                fill="none"
                stroke={ACCENT}
                strokeWidth="1"
                opacity="0.6"
              >
                <animate
                  attributeName="r"
                  values="5;14;5"
                  dur="1.8s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.6;0;0.6"
                  dur="1.8s"
                  repeatCount="indefinite"
                />
              </circle>
            )}
            <rect
              x="56"
              y={y + 1}
              rx="1.5"
              height="10"
              width={active ? 110 : done ? 88 : 64}
              fill={active ? 'rgba(167,139,250,0.18)' : 'transparent'}
              stroke={active ? ACCENT : done ? SOFT : FAINT}
              strokeWidth="1"
            />
          </g>
        );
      })}
    </svg>
  ),

  // 02 ROUTING — three provider lines fanning into a single output.
  routing: (
    <svg {...SVG_PROPS}>
      {[28, 70, 112].map((y, i) => (
        <circle
          key={i}
          cx="32"
          cy={y}
          r="6"
          fill="#0e0c14"
          stroke={i === 0 ? ACCENT : FAINT}
          strokeWidth={i === 0 ? 1.6 : 1.2}
        />
      ))}
      <circle cx="32" cy="28" r="2" fill={ACCENT} />
      <path
        d="M 38 28 Q 100 28 168 70"
        fill="none"
        stroke={ACCENT}
        strokeWidth="1.6"
      />
      <path
        d="M 38 70 Q 100 70 168 70"
        fill="none"
        stroke={FAINT}
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <path
        d="M 38 112 Q 100 112 168 70"
        fill="none"
        stroke={FAINT}
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <circle cx="168" cy="70" r="9" fill="#0e0c14" stroke={ACCENT} strokeWidth="1.6" />
      <circle cx="168" cy="70" r="3" fill={ACCENT}>
        <animate
          attributeName="opacity"
          values="1;0.3;1"
          dur="1.6s"
          repeatCount="indefinite"
        />
      </circle>
    </svg>
  ),

  // 03 GATES — flow with diamond checkpoint, two arrows out (continue + rework).
  gates: (
    <svg {...SVG_PROPS}>
      <line x1="14" y1="70" x2="78" y2="70" stroke={SOFT} strokeWidth="1.4" />
      <circle cx="14" cy="70" r="4" fill={ACCENT} />
      <g transform="translate(100 70) rotate(45)">
        <rect
          x="-18"
          y="-18"
          width="36"
          height="36"
          fill="rgba(167,139,250,0.10)"
          stroke={ACCENT}
          strokeWidth="1.4"
        />
      </g>
      <path
        d="M 75 67 L 80 70 L 75 73"
        fill="none"
        stroke={SOFT}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <line x1="122" y1="70" x2="180" y2="70" stroke={ACCENT} strokeWidth="1.4" />
      <path
        d="M 175 67 L 180 70 L 175 73"
        fill="none"
        stroke={ACCENT}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="180" cy="70" r="4" fill={ACCENT} />
      <path
        d="M 100 88 Q 100 110 60 110"
        fill="none"
        stroke={FAINT}
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <path
        d="M 65 107 L 60 110 L 65 113"
        fill="none"
        stroke={FAINT}
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  ),

  // 04 PERSONAS — three nested layered frames.
  personas: (
    <svg {...SVG_PROPS}>
      <rect x="20" y="22" width="130" height="84" fill="none" stroke={FAINT} strokeWidth="1" rx="2" />
      <rect x="35" y="34" width="130" height="84" fill="none" stroke={SOFT} strokeWidth="1" rx="2" />
      <rect x="50" y="46" width="130" height="84" fill="rgba(167,139,250,0.08)" stroke={ACCENT} strokeWidth="1.4" rx="2" />
      <circle cx="115" cy="88" r="14" fill="#0e0c14" stroke={ACCENT} strokeWidth="1.4" />
      <circle cx="115" cy="83" r="4" fill={ACCENT} />
      <path d="M 105 99 Q 115 92 125 99" fill="none" stroke={ACCENT} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),

  // 05 OBSERVABILITY — live waveform with pulsing leading dot.
  observability: (
    <svg {...SVG_PROPS}>
      <line
        x1="14"
        y1="70"
        x2="186"
        y2="70"
        stroke={FAINT}
        strokeWidth="0.8"
        strokeDasharray="2 4"
      />
      <path
        d="M 14 70 L 28 70 L 36 50 L 50 96 L 64 56 L 80 92 L 96 48 L 112 100 L 128 60 L 144 86 L 160 54 L 176 88 L 186 70"
        fill="none"
        stroke={ACCENT}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="186" cy="70" r="4" fill={ACCENT}>
        <animate attributeName="r" values="4;7;4" dur="1.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0.4;1" dur="1.4s" repeatCount="indefinite" />
      </circle>
    </svg>
  ),

  // 06 SELF-HOSTED — stacked containers on a server-rack plinth.
  selfHosted: (
    <svg {...SVG_PROPS}>
      {[0, 1, 2].map((i) => {
        const y = 30 + i * 26;
        return (
          <g key={i}>
            <rect
              x="50"
              y={y}
              width="100"
              height="20"
              rx="2"
              fill={i === 1 ? 'rgba(167,139,250,0.12)' : 'transparent'}
              stroke={i === 1 ? ACCENT : SOFT}
              strokeWidth="1.2"
            />
            <circle cx="60" cy={y + 10} r="2.2" fill={i === 1 ? ACCENT : SOFT} />
          </g>
        );
      })}
      <line x1="30" y1="116" x2="170" y2="116" stroke={SOFT} strokeWidth="1.4" />
      <line x1="40" y1="120" x2="40" y2="124" stroke={SOFT} strokeWidth="1" />
      <line x1="160" y1="120" x2="160" y2="124" stroke={SOFT} strokeWidth="1" />
    </svg>
  ),
};
