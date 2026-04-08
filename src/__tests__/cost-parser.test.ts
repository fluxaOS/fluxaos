import { describe, expect, it } from 'vitest';
import { parseCostFromOutput } from '@/core/pipeline/cost-parser';

describe('parseCostFromOutput', () => {
  it('returns null for empty string', () => {
    expect(parseCostFromOutput('')).toBeNull();
  });

  it('returns null when no cost/token info found', () => {
    expect(parseCostFromOutput('Hello world\nDone.')).toBeNull();
  });

  it('parses "Total cost: $0.0234"', () => {
    const result = parseCostFromOutput('Total cost: $0.0234');
    expect(result).toEqual({
      costUsd: '0.023400',
      tokensIn: 0,
      tokensOut: 0,
    });
  });

  it('parses "Cost: $1.23"', () => {
    const result = parseCostFromOutput('Cost: $1.23');
    expect(result).toEqual({
      costUsd: '1.230000',
      tokensIn: 0,
      tokensOut: 0,
    });
  });

  it('parses cost without dollar sign', () => {
    const result = parseCostFromOutput('cost: 0.05');
    expect(result).toEqual({
      costUsd: '0.050000',
      tokensIn: 0,
      tokensOut: 0,
    });
  });

  it('parses "Input: 1234 tokens" and "Output: 567 tokens"', () => {
    const result = parseCostFromOutput(
      'Input: 1234 tokens\nOutput: 567 tokens'
    );
    expect(result).toEqual({
      costUsd: '0.000000',
      tokensIn: 1234,
      tokensOut: 567,
    });
  });

  it('parses "input_tokens: 1234" and "output_tokens: 567"', () => {
    const result = parseCostFromOutput(
      'input_tokens: 1234\noutput_tokens: 567'
    );
    expect(result).toEqual({
      costUsd: '0.000000',
      tokensIn: 1234,
      tokensOut: 567,
    });
  });

  it('parses "Tokens: 1234 in / 567 out"', () => {
    const result = parseCostFromOutput('Tokens: 1234 in / 567 out');
    expect(result).toEqual({
      costUsd: '0.000000',
      tokensIn: 1234,
      tokensOut: 567,
    });
  });

  it('parses compact form with pipe separator', () => {
    const result = parseCostFromOutput('Token: 500 in | 200 out');
    expect(result).toEqual({
      costUsd: '0.000000',
      tokensIn: 500,
      tokensOut: 200,
    });
  });

  it('parses cost + tokens together', () => {
    const stdout = [
      'Processing complete.',
      'Total cost: $0.0150',
      'Input: 2000 tokens',
      'Output: 800 tokens',
    ].join('\n');

    const result = parseCostFromOutput(stdout);
    expect(result).toEqual({
      costUsd: '0.015000',
      tokensIn: 2000,
      tokensOut: 800,
    });
  });

  it('is case insensitive', () => {
    const result = parseCostFromOutput('TOTAL COST: $0.99');
    expect(result).toEqual({
      costUsd: '0.990000',
      tokensIn: 0,
      tokensOut: 0,
    });
  });
});
