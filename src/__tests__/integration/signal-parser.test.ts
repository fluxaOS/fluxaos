import { describe, it, expect } from 'vitest';
import { parseSignalLine, type SkillSignal } from '@/core/orchestrator/signal-parser';

describe('signal-parser', () => {
  it('parses a valid flux:signal line with all fields', () => {
    const line = JSON.stringify({
      'flux:signal': {
        verdict: 'proceed',
        summary: 'Implemented the feature',
        cost_usd: 0.12,
        tokens_in: 8400,
        tokens_out: 3200,
        meta: { pr_number: 42, branch: 'feat/health' },
      },
    });
    const result = parseSignalLine(line);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('proceed');
    expect(result!.summary).toBe('Implemented the feature');
    expect(result!.costUsd).toBe(0.12);
    expect(result!.tokensIn).toBe(8400);
    expect(result!.tokensOut).toBe(3200);
    expect(result!.meta).toEqual({ pr_number: 42, branch: 'feat/health' });
  });

  it('parses a minimal signal with only verdict', () => {
    const line = JSON.stringify({ 'flux:signal': { verdict: 'hold' } });
    const result = parseSignalLine(line);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('hold');
    expect(result!.summary).toBeUndefined();
    expect(result!.costUsd).toBeUndefined();
    expect(result!.meta).toBeUndefined();
  });

  it('returns null for non-signal JSON', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [] } });
    expect(parseSignalLine(line)).toBeNull();
  });

  it('returns null for plain text', () => {
    expect(parseSignalLine('Hello world')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSignalLine('')).toBeNull();
  });

  it('throws for invalid verdict value', () => {
    const line = JSON.stringify({ 'flux:signal': { verdict: 'invalid' } });
    expect(() => parseSignalLine(line)).toThrow('invalid skill signal verdict');
  });

  it('throws for missing verdict', () => {
    const line = JSON.stringify({ 'flux:signal': { summary: 'no verdict' } });
    expect(() => parseSignalLine(line)).toThrow('invalid skill signal verdict');
  });

  it('accepts all four verdict values', () => {
    for (const verdict of ['proceed', 'hold', 'rework', 'abort']) {
      const line = JSON.stringify({ 'flux:signal': { verdict } });
      const result = parseSignalLine(line);
      expect(result!.verdict).toBe(verdict);
    }
  });

  it('extracts signal from stream-json tool_result content', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          tool_use_id: 'toolu_abc',
          type: 'tool_result',
          content: '{"flux:signal": {"verdict": "proceed", "summary": "Done"}}',
          is_error: false,
        }],
      },
    });
    const result = parseSignalLine(line);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('proceed');
    expect(result!.summary).toBe('Done');
  });

  it('extracts signal from stream-json tool_use_result.stdout', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          tool_use_id: 'toolu_abc',
          type: 'tool_result',
          content: '{"flux:signal": {"verdict": "rework", "summary": "Needs changes"}}',
          is_error: false,
        }],
      },
      tool_use_result: {
        stdout: '{"flux:signal": {"verdict": "rework", "summary": "Needs changes"}}',
        stderr: '',
      },
    });
    const result = parseSignalLine(line);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('rework');
    expect(result!.summary).toBe('Needs changes');
  });

  it('returns null for tool_result without signal', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          tool_use_id: 'toolu_abc',
          type: 'tool_result',
          content: 'just some regular output',
          is_error: false,
        }],
      },
    });
    expect(parseSignalLine(line)).toBeNull();
  });

  it('parses signal with reason: already_complete and meta.targetState', () => {
    const line = JSON.stringify({
      'flux:signal': {
        verdict: 'hold',
        reason: 'already_complete',
        summary: 'Health endpoint already implemented',
        meta: { targetState: 'deploy' },
      },
    });
    const result = parseSignalLine(line);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('hold');
    expect(result!.reason).toBe('already_complete');
    expect(result!.meta?.targetState).toBe('deploy');
  });

  it('parses signal with reason: needs_human and meta.question', () => {
    const line = JSON.stringify({
      'flux:signal': {
        verdict: 'hold',
        reason: 'needs_human',
        summary: 'Cannot determine auth strategy',
        meta: { question: 'Should this use OAuth or API keys?' },
      },
    });
    const result = parseSignalLine(line);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('hold');
    expect(result!.reason).toBe('needs_human');
    expect(result!.meta?.question).toBe('Should this use OAuth or API keys?');
  });

  it('parses signal with no reason field without error', () => {
    const line = JSON.stringify({
      'flux:signal': { verdict: 'hold', summary: 'pausing' },
    });
    const result = parseSignalLine(line);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe('hold');
    expect(result!.reason).toBeUndefined();
  });

  it('throws for invalid verdict in embedded signal', () => {
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          tool_use_id: 'toolu_abc',
          type: 'tool_result',
          content: '{"flux:signal": {"verdict": "invalid"}}',
          is_error: false,
        }],
      },
    });
    expect(() => parseSignalLine(line)).toThrow('invalid skill signal verdict');
  });
});
