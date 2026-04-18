import 'dotenv/config';
import { describe, it, expect, beforeAll } from 'vitest';
import { registry } from '@/config/registry';
import { bootstrap } from '@/config/bootstrap';
import type { StdoutParser } from '@/core/ports/stdout-parser';

describe('stdout parser adapter', () => {
  beforeAll(() => {
    bootstrap();
  });

  it('registers and resolves the stdoutParser adapter', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    expect(p).toBeDefined();
    expect(typeof p.getParser).toBe('function');
  });

  it('stream-json parser produces TranscriptEntries from an assistant text event', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    const parse = p.getParser('stream-json');
    const line = JSON.stringify({
      type: 'assistant',
      message: { id: 'msg_1', content: [{ type: 'text', text: 'hello' }] },
    });
    const entries = parse(line, 1);
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('text');
    expect(entries[0].text).toBe('hello');
  });

  it('stream-json parser produces a tool_call entry', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    const parse = p.getParser('stream-json');
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg_2',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'bash', input: { command: 'ls' } }],
      },
    });
    const entries = parse(line, 1);
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('tool_call');
    expect(entries[0].toolName).toBe('bash');
    expect(entries[0].toolCommand).toBe('ls');
  });

  it('text parser produces a single text entry', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    const parse = p.getParser('text');
    const entries = parse('plain output', 1);
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('text');
    expect(entries[0].text).toBe('plain output');
  });

  it('unknown output format throws', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    expect(() => p.getParser('does-not-exist')).toThrow(/unknown output format/);
  });

  it('non-JSON stream-json line becomes raw entry', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    const parse = p.getParser('stream-json');
    const entries = parse('not json', 5);
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('raw');
    expect(entries[0].text).toBe('not json');
  });
});
