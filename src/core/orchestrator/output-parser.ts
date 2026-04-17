/**
 * Output Parser — converts driver stdout lines into typed transcript entries.
 *
 * The driver writes JSON events to stdout. This parser converts each line
 * into a TranscriptEntry with a kind (text, tool_call, tool_result, result,
 * system, raw) and structured fields.
 *
 * Lines that aren't valid JSON become 'raw' entries.
 * Follows PAT's LiveOutput parsing logic.
 */

export type EntryKind =
  | 'text'
  | 'tool_call'
  | 'tool_result'
  | 'result'
  | 'system'
  | 'raw';

export interface TranscriptEntry {
  id: string;
  kind: EntryKind;
  lineNumber: number;
  text?: string;
  toolName?: string;
  toolCommand?: string;
  toolOutput?: string;
  isError?: boolean;
  cost?: number;
}

/**
 * Parse a single stdout line into one or more TranscriptEntries.
 *
 * The driver outputs one JSON object per line. The `type` field determines
 * the entry kind:
 * - "assistant" with content[].type="text" → text
 * - "assistant" with content[].type="tool_use" → tool_call
 * - "user" with content[].type="tool_result" → tool_result
 * - "result" → result (final summary with cost)
 * - "system" → system
 * - Non-JSON or unknown → raw
 */
export function parseLine(
  line: string,
  lineNumber: number,
): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  // Fast path: if it doesn't start with '{', it's not JSON
  if (!trimmed.startsWith('{')) {
    return [{ id: `raw-${lineNumber}`, kind: 'raw', lineNumber, text: trimmed }];
  }

  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return [{ id: `raw-${lineNumber}`, kind: 'raw', lineNumber, text: trimmed }];
  }

  const type = String(evt.type ?? '');
  const entries: TranscriptEntry[] = [];

  if (type === 'assistant') {
    const msg = (evt.message ?? {}) as Record<string, unknown>;
    const msgId = String(msg.id ?? evt.uuid ?? lineNumber);
    const parts = (msg.content as unknown[]) ?? [];

    for (const part of parts) {
      const p = part as Record<string, unknown>;
      if (p.type === 'text') {
        const text = String(p.text ?? '').trim();
        if (text) {
          entries.push({
            id: `${msgId}-text-${entries.length}`,
            kind: 'text',
            lineNumber,
            text,
          });
        }
      } else if (p.type === 'tool_use') {
        const input = (p.input ?? {}) as Record<string, unknown>;
        const cmd = String(
          input.command ?? input.description ?? JSON.stringify(input),
        ).slice(0, 300);
        entries.push({
          id: String(p.id ?? `${msgId}-tool-${entries.length}`),
          kind: 'tool_call',
          lineNumber,
          toolName: String(p.name ?? ''),
          toolCommand: cmd,
        });
      }
    }
    return entries;
  }

  if (type === 'user') {
    const msg = (evt.message ?? {}) as Record<string, unknown>;
    const parts = (msg.content as unknown[]) ?? [];

    for (const part of parts) {
      const p = part as Record<string, unknown>;
      if (p.type === 'tool_result') {
        const toolUseId = String(p.tool_use_id ?? '');
        const isError = Boolean(p.is_error);
        let output = '';
        const raw = p.content;
        if (typeof raw === 'string') {
          output = raw;
        } else if (Array.isArray(raw)) {
          output = (raw as unknown[])
            .map((c) => String((c as Record<string, unknown>).text ?? ''))
            .join('');
        }
        entries.push({
          id: `result-${toolUseId}-${lineNumber}`,
          kind: 'tool_result',
          lineNumber,
          toolOutput: output.trim(),
          isError,
        });
      }
    }
    return entries;
  }

  if (type === 'result') {
    const isError = Boolean(evt.is_error);
    const text = String(evt.result ?? '').trim();
    const cost = typeof evt.total_cost_usd === 'number' ? evt.total_cost_usd : undefined;
    return [{
      id: `result-${lineNumber}`,
      kind: 'result',
      lineNumber,
      text,
      isError,
      cost,
    }];
  }

  if (type === 'system') {
    const subtype = String(evt.subtype ?? '');
    const text = String(evt.message ?? evt.text ?? subtype).trim();
    return [{
      id: `system-${lineNumber}`,
      kind: 'system',
      lineNumber,
      text: text || subtype,
    }];
  }

  // Unknown JSON structure → raw
  return [{ id: `raw-${lineNumber}`, kind: 'raw', lineNumber, text: trimmed }];
}

/**
 * Parse a plain-text stdout line into a single text TranscriptEntry.
 * Used for drivers with output_format='text'.
 */
export function parseTextLine(
  line: string,
  lineNumber: number,
): TranscriptEntry[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  return [{ id: `text-${lineNumber}`, kind: 'text', lineNumber, text: trimmed }];
}

/**
 * Select the appropriate line parser based on driver output format.
 *
 * @param outputFormat - The output_format value from driver
 * @returns A parser function with the same signature as parseLine
 */
export function getParser(
  outputFormat: string,
): (line: string, lineNumber: number) => TranscriptEntry[] {
  switch (outputFormat) {
    case 'stream-json':
      return parseLine;
    case 'text':
      return parseTextLine;
    default:
      throw new Error(`unknown output format: ${outputFormat}`);
  }
}
