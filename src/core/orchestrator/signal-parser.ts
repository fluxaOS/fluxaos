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
  reason?: string;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  meta?: {
    targetState?: string;
    question?: string;
    [key: string]: unknown;
  };
}

/**
 * Parse a raw object as a flux:signal payload.
 *
 * @returns The parsed signal, or null if the object is not a signal.
 * @throws If the object IS a signal but has an invalid verdict.
 */
function parseSignalObject(
  parsed: Record<string, unknown>
): SkillSignal | null {
  const signal = parsed['flux:signal'];
  if (!signal || typeof signal !== 'object') return null;

  const data = signal as Record<string, unknown>;
  const verdict = data.verdict;

  if (typeof verdict !== 'string' || !VALID_VERDICTS.has(verdict)) {
    throw new Error(
      `invalid skill signal verdict: ${JSON.stringify(verdict)}. Must be one of: ${[...VALID_VERDICTS].join(', ')}`
    );
  }

  return {
    verdict: verdict as GateVerdict,
    summary: typeof data.summary === 'string' ? data.summary : undefined,
    reason: typeof data.reason === 'string' ? data.reason : undefined,
    costUsd: typeof data.cost_usd === 'number' ? data.cost_usd : undefined,
    tokensIn:
      typeof data.tokens_in === 'number'
        ? Math.floor(data.tokens_in)
        : undefined,
    tokensOut:
      typeof data.tokens_out === 'number'
        ? Math.floor(data.tokens_out)
        : undefined,
    meta:
      data.meta && typeof data.meta === 'object'
        ? (data.meta as {
            targetState?: string;
            question?: string;
            [key: string]: unknown;
          })
        : undefined,
  };
}

/**
 * Attempt to parse a stdout line as a flux:signal.
 *
 * Checks two locations:
 * 1. The line itself is a top-level {"flux:signal": {...}} JSON object
 * 2. The line is a stream-json tool_result event whose content contains
 *    the signal (e.g., from a `echo '{"flux:signal": ...}'` Bash call)
 *
 * @returns The parsed signal, or null if the line is not a signal.
 * @throws If the line IS a signal but has an invalid verdict.
 */
export function parseSignalLine(line: string): SkillSignal | null {
  const trimmed = line.trim();
  if (!trimmed?.startsWith('{')) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  // Case 1: Top-level signal line
  const direct = parseSignalObject(parsed);
  if (direct) return direct;

  // Case 2: Signal embedded in a stream-json tool_result event
  // Shape: {"type":"user","message":{"content":[{"type":"tool_result","content":"..."}]}}
  // Also check tool_use_result.stdout for the same signal
  if (parsed.type === 'user') {
    const msg = parsed.message as Record<string, unknown> | undefined;
    if (!msg) return null;

    // Check tool_use_result.stdout first (most direct)
    const toolResult = parsed.tool_use_result as
      | Record<string, unknown>
      | undefined;
    if (toolResult?.stdout && typeof toolResult.stdout === 'string') {
      const signal = extractSignalFromText(toolResult.stdout);
      if (signal) return signal;
    }

    // Check message.content[].content for tool_result entries
    const parts = msg.content as unknown[] | undefined;
    if (!Array.isArray(parts)) return null;

    for (const part of parts) {
      const p = part as Record<string, unknown>;
      if (p.type !== 'tool_result') continue;
      if (typeof p.content === 'string') {
        const signal = extractSignalFromText(p.content);
        if (signal) return signal;
      }
    }
  }

  return null;
}

/**
 * Try to parse a text string as a flux:signal JSON payload.
 * The text may contain the signal on any line.
 */
function extractSignalFromText(text: string): SkillSignal | null {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(t) as Record<string, unknown>;
    } catch {
      continue;
    }
    // parseSignalObject may throw for invalid verdicts — let it propagate
    const signal = parseSignalObject(obj);
    if (signal) return signal;
  }
  return null;
}
