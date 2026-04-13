/**
 * fluxaOS Brand Theme — Tailwind CSS Extension
 *
 * ONLY contains what Tailwind doesn't provide out of the box.
 * Slate, spacing, radius, and font-size use Tailwind defaults — don't redeclare them.
 *
 * Usage:
 * ```ts
 * import { fluxTheme } from './branding/tailwind-theme'
 * export default { theme: { extend: fluxTheme } }
 * ```
 */

export const fluxTheme = {
  colors: {
    // Brand — Violet Gradient (fluxaOS-specific, not in Tailwind)
    brand: {
      void: '#0B0014',
      abyss: '#150030',
      deep: '#2D1B69',
      DEFAULT: '#5B21B6', // Royal Violet — primary
      electric: '#7C3AED',
      soft: '#A78BFA',
      pale: '#DDD6FE',
    },

    // Semantic — intentionally different from Tailwind defaults
    // Deeper, richer tones that pair with the violet dark-mode palette
    success: '#188C42',
    warning: '#F5A314',
    error: '#CE1212',
    info: '#097FC3',
  },

  // Slate: use Tailwind's built-in slate-* utilities directly (bg-slate-800, text-slate-400, etc.)
  // Spacing: use Tailwind defaults (p-4, gap-6, etc.)
  // Border radius: use Tailwind defaults (rounded-sm, rounded-lg, etc.)
  // Font size: use Tailwind defaults (text-sm, text-xl, etc.)

  fontFamily: {
    sans: ['Geist Sans', 'Inter', 'system-ui', 'sans-serif'],
    mono: ['Geist Mono', 'JetBrains Mono', 'Fira Code', 'monospace'],
  },
} as const;
