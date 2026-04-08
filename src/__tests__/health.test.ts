import { describe, expect, it } from 'vitest';
import { appRouter } from '@/server/root';
import { createCallerFactory } from '@/server/trpc';

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({});

describe('health router', () => {
  it('returns ok status with timestamp', async () => {
    const result = await caller.health.check();
    expect(result.status).toBe('ok');
    expect(result.timestamp).toBeDefined();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });
});
