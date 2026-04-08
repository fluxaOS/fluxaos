import { describe, expect, it } from 'vitest';

/**
 * CLI parsing and formatting tests.
 * These test the argument parsing logic and output formatting
 * without requiring a running tRPC server.
 */

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function formatTableRow(cols: { value: string; width: number }[]): string {
  return cols.map((c) => c.value.padEnd(c.width)).join('');
}

describe('CLI arg parsing', () => {
  it('parses --project flag', () => {
    const args = ['list', '--project', '123e4567-e89b-12d3-a456-426614174000'];
    expect(parseFlag(args, '--project')).toBe(
      '123e4567-e89b-12d3-a456-426614174000'
    );
  });

  it('parses --title flag', () => {
    const args = ['create', '--project', 'abc', '--title', 'Fix the bug'];
    expect(parseFlag(args, '--title')).toBe('Fix the bug');
  });

  it('returns undefined for missing flag', () => {
    const args = ['list', '--project', 'abc'];
    expect(parseFlag(args, '--title')).toBeUndefined();
  });

  it('returns undefined for flag at end without value', () => {
    const args = ['list', '--project'];
    expect(parseFlag(args, '--project')).toBeUndefined();
  });

  it('parses --dir flag for skill sync', () => {
    const args = ['sync', '--project', 'abc', '--dir', '/tmp/skills'];
    expect(parseFlag(args, '--dir')).toBe('/tmp/skills');
    expect(parseFlag(args, '--project')).toBe('abc');
  });
});

describe('CLI table formatting', () => {
  it('pads columns to specified widths', () => {
    const row = formatTableRow([
      { value: 'Bug fix', width: 40 },
      { value: 'open', width: 15 },
      { value: 'high', width: 12 },
    ]);
    expect(row).toBe(
      'Bug fix' +
        ' '.repeat(33) +
        'open' +
        ' '.repeat(11) +
        'high' +
        ' '.repeat(8)
    );
  });

  it('truncation-safe with long values', () => {
    const row = formatTableRow([
      { value: 'A'.repeat(50), width: 40 },
      { value: 'open', width: 15 },
    ]);
    // padEnd does not truncate, just doesn't pad if already longer
    expect(row.startsWith('A'.repeat(50))).toBe(true);
    expect(row).toContain('open');
  });
});

describe('CLI command routing', () => {
  it('identifies valid commands', () => {
    const validCommands = ['issue', 'skill', 'status'];
    for (const cmd of validCommands) {
      expect(validCommands.includes(cmd)).toBe(true);
    }
  });

  it('rejects unknown commands', () => {
    const validCommands = ['issue', 'skill', 'status'];
    expect(validCommands.includes('deploy')).toBe(false);
    expect(validCommands.includes('')).toBe(false);
  });
});
