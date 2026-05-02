import { describe, it, expect } from 'vitest';
import { composePrompt } from '@/core/pipeline/prompt-composer';

describe('composePrompt', () => {
  it('concatenates base prompt and skill prompt', () => {
    const result = composePrompt('Base prompt.', 'Skill work here.');
    expect(result).toContain('Base prompt.');
    expect(result).toContain('Skill work here.');
  });

  it('substitutes ${RESULT_DOC_PATH} in base prompt', () => {
    const result = composePrompt('Write to ${RESULT_DOC_PATH} when done.', 'Work.', {
      RESULT_DOC_PATH: '/tmp/result.json',
    });
    expect(result).toContain('/tmp/result.json');
    expect(result).not.toContain('${RESULT_DOC_PATH}');
  });

  it('substitutes ${ARTIFACTS_DIR} in skill prompt', () => {
    const result = composePrompt('Base.', 'Read ${ARTIFACTS_DIR}/plan.md.', {
      ARTIFACTS_DIR: '/tmp/artifacts',
    });
    expect(result).toContain('/tmp/artifacts/plan.md');
    expect(result).not.toContain('${ARTIFACTS_DIR}');
  });

  it('leaves unmatched vars untouched', () => {
    const result = composePrompt('Hello ${UNKNOWN}.', 'Work.', {});
    expect(result).toContain('${UNKNOWN}');
  });
});
