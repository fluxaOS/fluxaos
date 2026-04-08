import { describe, expect, it } from 'vitest';

// Test the matchesPattern logic (extracted for unit testing)
function matchesPattern(identifier: string, pattern: string): boolean {
  if (!pattern || pattern === '*') return true;
  const regex = new RegExp(
    `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`
  );
  return regex.test(identifier);
}

describe('routing resolver - pattern matching', () => {
  it('wildcard * matches everything', () => {
    expect(matchesPattern('claude-sonnet-4-20250514', '*')).toBe(true);
    expect(matchesPattern('gpt-4o', '*')).toBe(true);
  });

  it('empty pattern matches everything', () => {
    expect(matchesPattern('claude-sonnet-4-20250514', '')).toBe(true);
  });

  it('exact match works', () => {
    expect(
      matchesPattern('claude-sonnet-4-20250514', 'claude-sonnet-4-20250514')
    ).toBe(true);
    expect(matchesPattern('gpt-4o', 'claude-sonnet-4-20250514')).toBe(false);
  });

  it('prefix glob matches', () => {
    expect(matchesPattern('claude-sonnet-4-20250514', 'claude-*')).toBe(true);
    expect(matchesPattern('gpt-4o', 'claude-*')).toBe(false);
  });

  it('suffix glob matches', () => {
    expect(matchesPattern('claude-sonnet-4-20250514', '*-20250514')).toBe(true);
    expect(matchesPattern('gpt-4o', '*-20250514')).toBe(false);
  });

  it('middle glob matches', () => {
    expect(
      matchesPattern('claude-sonnet-4-20250514', 'claude-*-20250514')
    ).toBe(true);
    expect(matchesPattern('claude-opus-4-20250514', 'claude-*-20250514')).toBe(
      true
    );
    expect(matchesPattern('gpt-4o', 'claude-*-20250514')).toBe(false);
  });

  it('escapes special regex characters', () => {
    expect(matchesPattern('model.v1', 'model.v1')).toBe(true);
    expect(matchesPattern('modelXv1', 'model.v1')).toBe(false);
  });
});
