import { describe, expect, it } from 'vitest';
import { VALID_TRANSITIONS } from '@/core/issues/types';

describe('issue state transitions', () => {
  it('allows open → in_progress, blocked, closed', () => {
    expect(VALID_TRANSITIONS.open).toEqual([
      'in_progress',
      'blocked',
      'closed',
    ]);
  });

  it('allows in_progress → open, blocked, closed', () => {
    expect(VALID_TRANSITIONS.in_progress).toEqual([
      'open',
      'blocked',
      'closed',
    ]);
  });

  it('allows blocked → open, in_progress', () => {
    expect(VALID_TRANSITIONS.blocked).toEqual(['open', 'in_progress']);
  });

  it('allows closed → open only', () => {
    expect(VALID_TRANSITIONS.closed).toEqual(['open']);
  });

  it('does not allow closed → in_progress directly', () => {
    expect(VALID_TRANSITIONS.closed).not.toContain('in_progress');
  });
});
