/**
 * Signal Parser — recognizes and parses flux:signal JSON lines from skill stdout.
 *
 * Skills emit structured JSON lines with a flux:signal key to communicate
 * their verdict back to the orchestrator. This parser extracts and validates
 * those signals. Non-signal lines return null.
 */
import { GATE_VERDICT, type GateVerdict } from '@/core/constants';

const VALID_VERDICTS = new Set<string>(Object.values(GATE_VERDICT));

export interface SkillSignal {
  verdict: GateVerdict;
  summary?: string;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  meta?: Record<string, unknown>;
}

/**
 * Attempt to parse a stdout line as a flux:signal.
 *
 * @returns The parsed signal, or null if the line is not a signal.
 * @throws If the line IS a signal but has an invalid verdict.
 */
export function parseSignalLine(line: string): SkillSignal | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  const signal = parsed['flux:signal'];
  if (!signal || typeof signal !== 'object') return null;

  const data = signal as Record<string, unknown>;
  const verdict = data.verdict;

  if (typeof verdict !== 'string' || !VALID_VERDICTS.has(verdict)) {
    throw new Error(
      `invalid skill signal verdict: ${JSON.stringify(verdict)}. Must be one of: ${[...VALID_VERDICTS].join(', ')}`,
    );
  }

  return {
    verdict: verdict as GateVerdict,
    summary: typeof data.summary === 'string' ? data.summary : undefined,
    costUsd: typeof data.cost_usd === 'number' ? data.cost_usd : undefined,
    tokensIn: typeof data.tokens_in === 'number' ? Math.floor(data.tokens_in) : undefined,
    tokensOut: typeof data.tokens_out === 'number' ? Math.floor(data.tokens_out) : undefined,
    meta: data.meta && typeof data.meta === 'object' ? (data.meta as Record<string, unknown>) : undefined,
  };
}
