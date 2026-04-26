import 'dotenv/config';
import { beforeAll, describe, expect, it } from 'vitest';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
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
        content: [
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'bash',
            input: { command: 'ls' },
          },
        ],
      },
    });
    const entries = parse(line, 1);
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('tool_call');
    expect(entries[0].toolName).toBe('bash');
    expect(entries[0].toolCommand).toBe('ls');
  });

  it('stream-json parser produces a tool_result entry', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    const parse = p.getParser('stream-json');
    const line = JSON.stringify({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_1',
            content: 'file contents',
            is_error: false,
          },
        ],
      },
    });
    const entries = parse(line, 2);
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('tool_result');
    expect(entries[0].toolOutput).toBe('file contents');
    expect(entries[0].isError).toBe(false);
  });

  it('stream-json parser produces a result entry with cost', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    const parse = p.getParser('stream-json');
    const line = JSON.stringify({
      type: 'result',
      result: 'Task completed',
      is_error: false,
      total_cost_usd: 0.0523,
    });
    const entries = parse(line, 3);
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('result');
    expect(entries[0].text).toBe('Task completed');
    expect(entries[0].isError).toBe(false);
    expect(entries[0].cost).toBe(0.0523);
  });

  it('stream-json parser produces a system entry', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    const parse = p.getParser('stream-json');
    const line = JSON.stringify({
      type: 'system',
      subtype: 'init',
      message: 'Session started',
    });
    const entries = parse(line, 4);
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('system');
    expect(entries[0].text).toBe('Session started');
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
    expect(() => p.getParser('does-not-exist')).toThrow(
      /unknown output format/
    );
  });

  it('non-JSON stream-json line becomes raw entry', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    const parse = p.getParser('stream-json');
    const entries = parse('not json', 5);
    expect(entries.length).toBe(1);
    expect(entries[0].kind).toBe('raw');
    expect(entries[0].text).toBe('not json');
  });

  it('stream-json parser returns empty array for empty line', () => {
    const p = registry.get<StdoutParser>('stdoutParser');
    const parse = p.getParser('stream-json');
    const entries = parse('', 6);
    expect(entries.length).toBe(0);
  });
});
