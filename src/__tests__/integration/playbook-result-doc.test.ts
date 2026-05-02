import { describe, it, expect } from 'vitest';
import {
  ResultDocSchema,
  validateResultDoc,
  isValidResultDoc,
} from '@/core/pipeline/result-doc';

describe('ResultDocSchema', () => {
  const minimalValid = {
    issue: { id: 'uuid-1', number: 1, title: 'Test issue' },
    run: { pipelineRunId: 'uuid-2', stageRunId: 'uuid-3', stage: 'implement', attempt: 1 },
    org: { id: 'uuid-4', slug: 'acme' },
    project: { id: 'uuid-5', slug: 'myapp' },
    timing: { startedAt: '2026-05-02T03:00:00-07:00' },
    verdict: 'pass' as const,
    summary: 'Implementation complete.',
  };

  it('accepts minimal valid doc', () => {
    expect(() => ResultDocSchema.parse(minimalValid)).not.toThrow();
  });

  it('accepts full doc with all optional fields', () => {
    const full = {
      ...minimalValid,
      comment: 'Work looks good.',
      blockers: [{ title: 'Broken CI', description: 'CI is red on main.' }],
      artifacts: ['research-findings.md'],
      timing: {
        ...minimalValid.timing,
        endedAt: '2026-05-02T03:02:22-07:00',
        duration_sec: 142,
      },
      meta: { model: 'claude-sonnet-4-6', input_tokens: 1000, output_tokens: 200 },
    };
    expect(() => ResultDocSchema.parse(full)).not.toThrow();
  });

  it('rejects missing verdict', () => {
    const { verdict, ...rest } = minimalValid;
    expect(() => ResultDocSchema.parse(rest)).toThrow();
  });

  it('rejects missing summary', () => {
    const { summary, ...rest } = minimalValid;
    expect(() => ResultDocSchema.parse(rest)).toThrow();
  });

  it('accepts verdict: blocked', () => {
    expect(() => ResultDocSchema.parse({ ...minimalValid, verdict: 'blocked' })).not.toThrow();
  });

  it('rejects invalid verdict value', () => {
    // 'proceed' is the old signal format — not a valid ResultDoc verdict
    expect(() => ResultDocSchema.parse({ ...minimalValid, verdict: 'proceed' })).toThrow();
  });

  it('isValidResultDoc returns false for incomplete doc', () => {
    expect(isValidResultDoc({ verdict: 'pass' })).toBe(false);
  });

  it('isValidResultDoc returns true for valid doc', () => {
    expect(isValidResultDoc(minimalValid)).toBe(true);
  });
});

describe('validateResultDoc', () => {
  it('returns parsed doc on success', () => {
    const doc = {
      issue: { id: 'u1', number: 1, title: 'T' },
      run: { pipelineRunId: 'u2', stageRunId: 'u3', stage: 'research', attempt: 1 },
      org: { id: 'u4', slug: 'o' },
      project: { id: 'u5', slug: 'p' },
      timing: { startedAt: '2026-05-02T00:00:00Z' },
      verdict: 'fail' as const,
      summary: 'Failed.',
    };
    const result = validateResultDoc(doc);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.verdict).toBe('fail');
  });

  it('returns error on invalid doc', () => {
    const result = validateResultDoc({ verdict: 'bad' });
    expect(result.success).toBe(false);
  });
});
