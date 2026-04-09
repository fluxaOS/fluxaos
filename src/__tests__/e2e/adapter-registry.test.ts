import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterRegistry } from '@/config/registry';

describe('AdapterRegistry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('registers and retrieves an adapter', () => {
    const reg = new AdapterRegistry();
    const fakeAuth = { login: () => 'ok' };
    reg.register('auth', 'test', () => fakeAuth);

    vi.stubEnv('FLUXAOS_AUTH_PROVIDER', 'test');
    const result = reg.get<typeof fakeAuth>('auth');
    expect(result.login()).toBe('ok');
  });

  it('uses default provider when env is not set', () => {
    const reg = new AdapterRegistry();
    const fakeAuth = { provider: 'supabase' };
    reg.register('auth', 'supabase', () => fakeAuth);

    // No env override — should use default 'supabase'
    vi.stubEnv('FLUXAOS_AUTH_PROVIDER', '');
    const result = reg.get<typeof fakeAuth>('auth');
    expect(result.provider).toBe('supabase');
  });

  it('throws on missing adapter', () => {
    const reg = new AdapterRegistry();

    vi.stubEnv('FLUXAOS_AUTH_PROVIDER', 'nonexistent');
    expect(() => reg.get('auth')).toThrow(/No adapter registered/);
  });

  it('caches singleton instances', () => {
    const reg = new AdapterRegistry();
    let callCount = 0;
    reg.register('queue', 'bullmq', () => {
      callCount++;
      return { type: 'queue' };
    });

    vi.stubEnv('FLUXAOS_QUEUE_PROVIDER', 'bullmq');
    const first = reg.get('queue');
    const second = reg.get('queue');
    expect(first).toBe(second); // Same reference
    expect(callCount).toBe(1); // Factory called once
  });

  it('env override selects a different adapter', () => {
    const reg = new AdapterRegistry();
    reg.register('ai', 'anthropic', () => ({ name: 'anthropic' }));
    reg.register('ai', 'openai', () => ({ name: 'openai' }));

    vi.stubEnv('FLUXAOS_AI_PROVIDERS', 'openai');
    const result = reg.get<{ name: string }>('ai');
    expect(result.name).toBe('openai');
  });

  it('getProvider returns env value or default', () => {
    const reg = new AdapterRegistry();

    vi.stubEnv('FLUXAOS_GIT_PROVIDER', '');
    expect(reg.getProvider('git')).toBe('github'); // default

    vi.stubEnv('FLUXAOS_GIT_PROVIDER', 'gitlab');
    expect(reg.getProvider('git')).toBe('gitlab');
  });

  it('getRegisteredAdapters returns all adapter types', () => {
    const reg = new AdapterRegistry();
    const adapters = reg.getRegisteredAdapters();

    expect(adapters).toHaveProperty('auth');
    expect(adapters).toHaveProperty('git');
    expect(adapters).toHaveProperty('issue');
    expect(adapters).toHaveProperty('ai');
    expect(adapters).toHaveProperty('database');
    expect(adapters).toHaveProperty('queue');
    expect(adapters).toHaveProperty('realtime');
    expect(adapters).toHaveProperty('stage-executor');
    expect(adapters).toHaveProperty('notification');
    expect(adapters).toHaveProperty('storage');
  });

  it('error message lists available adapters for the type', () => {
    const reg = new AdapterRegistry();
    reg.register('ai', 'anthropic', () => ({}));
    reg.register('ai', 'openai', () => ({}));

    vi.stubEnv('FLUXAOS_AI_PROVIDERS', 'cohere');
    expect(() => reg.get('ai')).toThrow(/anthropic/);
    expect(() => reg.get('ai')).toThrow(/openai/);
  });
});
