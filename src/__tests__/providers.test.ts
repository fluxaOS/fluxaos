import { describe, expect, it } from 'vitest';
import type {
  CreateModelInput,
  CreateProviderInput,
  UpdateModelInput,
  UpdateProviderInput,
} from '@/core/providers/types';

describe('provider types', () => {
  it('CreateProviderInput accepts required fields', () => {
    const input: CreateProviderInput = {
      orgId: '00000000-0000-0000-0000-000000000001',
      name: 'Anthropic',
      type: 'anthropic',
    };
    expect(input.name).toBe('Anthropic');
    expect(input.type).toBe('anthropic');
    expect(input.baseUrl).toBeUndefined();
  });

  it('CreateProviderInput accepts all fields', () => {
    const input: CreateProviderInput = {
      orgId: '00000000-0000-0000-0000-000000000001',
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyRef: 'env:OPENAI_API_KEY',
    };
    expect(input.baseUrl).toBe('https://api.openai.com/v1');
    expect(input.apiKeyRef).toBe('env:OPENAI_API_KEY');
  });

  it('UpdateProviderInput allows health status toggle', () => {
    const input: UpdateProviderInput = { isHealthy: false };
    expect(input.isHealthy).toBe(false);
    expect(input.name).toBeUndefined();
  });
});

describe('model types', () => {
  it('CreateModelInput accepts required fields', () => {
    const input: CreateModelInput = {
      providerId: '00000000-0000-0000-0000-000000000001',
      name: 'Claude Opus 4',
      identifier: 'claude-opus-4-6',
    };
    expect(input.name).toBe('Claude Opus 4');
    expect(input.identifier).toBe('claude-opus-4-6');
  });

  it('CreateModelInput accepts cost and capability fields', () => {
    const input: CreateModelInput = {
      providerId: '00000000-0000-0000-0000-000000000001',
      name: 'Claude Sonnet 4',
      identifier: 'claude-sonnet-4-6',
      capabilities: { vision: true, tools: true, streaming: true },
      costPer1kInput: '0.003000',
      costPer1kOutput: '0.015000',
    };
    expect((input.capabilities as Record<string, boolean>).vision).toBe(true);
    expect(input.costPer1kInput).toBe('0.003000');
  });

  it('UpdateModelInput allows partial updates', () => {
    const input: UpdateModelInput = {
      costPer1kInput: '0.004000',
      costPer1kOutput: '0.016000',
    };
    expect(input.name).toBeUndefined();
    expect(input.costPer1kInput).toBe('0.004000');
  });
});

describe('provider-model cascade logic', () => {
  it('deleting a provider should conceptually cascade to models', () => {
    const providers = [
      { id: 'p1', name: 'Anthropic' },
      { id: 'p2', name: 'OpenAI' },
    ];
    const models = [
      { id: 'm1', providerId: 'p1', name: 'Opus' },
      { id: 'm2', providerId: 'p1', name: 'Sonnet' },
      { id: 'm3', providerId: 'p2', name: 'GPT-4o' },
    ];

    // Simulate: delete provider p1 → models m1, m2 should be removed
    const deletedProviderId = 'p1';
    const remainingModels = models.filter(
      (m) => m.providerId !== deletedProviderId
    );
    const remainingProviders = providers.filter(
      (p) => p.id !== deletedProviderId
    );

    expect(remainingProviders).toHaveLength(1);
    expect(remainingModels).toHaveLength(1);
    expect(remainingModels[0].name).toBe('GPT-4o');
  });
});
