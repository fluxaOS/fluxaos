import { describe, expect, it } from 'vitest';
import type {
  CreateRoutingProfileInput,
  CreateRoutingRuleInput,
  UpdateRoutingProfileInput,
  UpdateRoutingRuleInput,
} from '@/core/routing/types';

describe('routing profile types', () => {
  it('CreateRoutingProfileInput accepts required fields', () => {
    const input: CreateRoutingProfileInput = {
      orgId: '00000000-0000-0000-0000-000000000001',
      name: 'High Quality',
    };
    expect(input.name).toBe('High Quality');
    expect(input.isDefault).toBeUndefined();
  });

  it('CreateRoutingProfileInput accepts all fields', () => {
    const input: CreateRoutingProfileInput = {
      orgId: '00000000-0000-0000-0000-000000000001',
      name: 'Cost Optimized',
      description: 'Prefers cheaper models',
      isDefault: true,
    };
    expect(input.isDefault).toBe(true);
    expect(input.description).toBe('Prefers cheaper models');
  });

  it('UpdateRoutingProfileInput allows partial updates', () => {
    const input: UpdateRoutingProfileInput = { isDefault: true };
    expect(input.name).toBeUndefined();
    expect(input.isDefault).toBe(true);
  });
});

describe('routing rule types', () => {
  it('CreateRoutingRuleInput accepts profile binding', () => {
    const input: CreateRoutingRuleInput = {
      profileId: '00000000-0000-0000-0000-000000000001',
      stageName: 'research',
      sortStrategy: 'quality',
    };
    expect(input.stageName).toBe('research');
    expect(input.sortStrategy).toBe('quality');
  });

  it('CreateRoutingRuleInput accepts cost constraints', () => {
    const input: CreateRoutingRuleInput = {
      profileId: '00000000-0000-0000-0000-000000000001',
      allowedModelsPattern: 'claude-*',
      preferredHarness: 'claude-code',
      fallbackHarness: 'aider',
      maxCostUsd: '5.000000',
    };
    expect(input.allowedModelsPattern).toBe('claude-*');
    expect(input.maxCostUsd).toBe('5.000000');
  });

  it('UpdateRoutingRuleInput allows partial updates', () => {
    const input: UpdateRoutingRuleInput = { sortStrategy: 'cost' };
    expect(input.sortStrategy).toBe('cost');
    expect(input.stageName).toBeUndefined();
  });
});

describe('isDefault toggle logic', () => {
  it('setting isDefault should conceptually unset others', () => {
    const profiles = [
      { id: 'a', isDefault: true },
      { id: 'b', isDefault: false },
      { id: 'c', isDefault: false },
    ];

    // Simulate: set 'b' as default → 'a' becomes false
    const newDefault = 'b';
    const updated = profiles.map((p) => ({
      ...p,
      isDefault: p.id === newDefault,
    }));

    expect(updated.find((p) => p.id === 'a')?.isDefault).toBe(false);
    expect(updated.find((p) => p.id === 'b')?.isDefault).toBe(true);
    expect(updated.find((p) => p.id === 'c')?.isDefault).toBe(false);
  });
});
