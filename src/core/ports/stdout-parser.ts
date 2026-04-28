/**
 * StdoutParser port — converts subprocess stdout lines into typed transcript entries.
 *
 * Implementations live in src/adapters/. The orchestrator resolves a parser
 * factory from the registry based on a driver's output_format field.
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
  isStderr?: boolean;
  cost?: number;
  /**
   * For `kind: 'system'` entries: the parsed `subtype` field from the
   * driver's stream-json line (e.g. "init", "hook_started", "hook_response").
   * Lets the UI hide lifecycle chatter in verbose mode while keeping the
   * entries available in the raw-JSON view.
   */
  systemSubtype?: string;
}

export type LineParser = (
  line: string,
  lineNumber: number
) => TranscriptEntry[];

export interface StdoutParser {
  /**
   * Select a line parser by driver output format.
   * Throws `Error('unknown output format: <format>')` on unknown formats.
   */
  getParser(outputFormat: string): LineParser;
}
