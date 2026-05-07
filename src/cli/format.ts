/**
 * Output formatting helpers — terminal columns + JSON mode.
 *
 * `--json` switches every command to a single machine-readable JSON line on
 * stdout. Errors always go to stderr regardless of mode. Exit codes:
 *   0 — success
 *   1 — runtime/server error
 *   2 — config or argument error
 */

export type OutputMode = 'text' | 'json';

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function pad(s: string, width: number): string {
  return s.padEnd(width);
}

export function printRows(
  headers: { key: string; label: string; width: number }[],
  rows: Array<Record<string, string | number | null | undefined>>
): void {
  const headerLine = headers.map((h) => pad(h.label, h.width)).join('  ');
  console.log(headerLine);
  console.log('-'.repeat(headerLine.length));
  for (const row of rows) {
    console.log(
      headers
        .map((h) => {
          const v = row[h.key];
          const str = v === null || v === undefined ? '–' : String(v);
          return pad(truncate(str, h.width - 1), h.width);
        })
        .join('  ')
    );
  }
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value));
}
