import 'dotenv/config';
import { describe, it, expect, beforeAll } from 'vitest';
import { registry } from '@/config/registry';
import { bootstrap } from '@/config/bootstrap';
import type { RealtimeProvider } from '@/core/ports/realtime';

describe('realtime adapter', () => {
  beforeAll(() => {
    bootstrap();
  });

  it('registers and resolves the realtime adapter', () => {
    const rt = registry.get<RealtimeProvider>('realtime');
    expect(rt).toBeDefined();
    expect(typeof rt.subscribe).toBe('function');
    expect(typeof rt.subscribeToTable).toBe('function');
    expect(typeof rt.broadcast).toBe('function');
  });

  it('returns an unsubscribe function from subscribeToTable', () => {
    const rt = registry.get<RealtimeProvider>('realtime');
    const unsub = rt.subscribeToTable('test-channel', 'event', '*', () => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });
});
