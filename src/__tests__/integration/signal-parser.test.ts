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
});
