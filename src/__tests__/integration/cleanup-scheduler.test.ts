/**
 * Integration tests: cleanup-scheduler lifecycle.
 *
 * Tests the setInterval harness in isolation. The cleanupService dep is
 * mocked (just a call counter) per the task spec — the DB-backed service
 * is covered in cleanup-triggers.test.ts. Uses vitest fake timers so a
 * 1-minute interval can be exercised without waiting.
 *
 * Config values are injected via deps (no process.env reads in the
 * scheduler itself — env parsing moved to loadFluxaosConfig in
 * src/config/env.ts per FLX-138).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCleanupScheduler } from '@/core/cleanup/cleanup-scheduler';
import type {
  CleanupLogger,
  CleanupReport,
} from '@/core/cleanup/cleanup-service';

function makeLogger(): CleanupLogger & {
  records: { level: string; obj: Record<string, unknown>; msg?: string }[];
} {
  const records: {
    level: string;
    obj: Record<string, unknown>;
    msg?: string;
  }[] = [];
  return {
    records,
    info: (obj, msg) => records.push({ level: 'info', obj, msg }),
    warn: (obj, msg) => records.push({ level: 'warn', obj, msg }),
    error: (obj, msg) => records.push({ level: 'error', obj, msg }),
  };
}

function makeService() {
  let calls = 0;
  return {
    runScheduledSweep: async (): Promise<CleanupReport> => {
      calls += 1;
      return {
        removed: [],
        skipped: [],
        errors: [],
        startedAt: new Date(),
        completedAt: new Date(),
      };
    },
    get callCount() {
      return calls;
    },
  };
}

const DEFAULT_DEPS = {
  sweepIntervalMin: 1,
  staleDays: 14,
  sessionRetentionDays: 30,
  artifactsRetentionDays: 7,
} as const;

describe('cleanup-scheduler', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts and fires sweep on interval', async () => {
    vi.useFakeTimers();
    const cleanupService = makeService();
    const logger = makeLogger();
    const scheduler = createCleanupScheduler({
      cleanupService,
      logger,
      ...DEFAULT_DEPS,
    });

    scheduler.start();

    expect(scheduler.isRunning()).toBe(true);
    expect(cleanupService.callCount).toBe(0); // not called until interval fires

    // 1 minute in ms.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cleanupService.callCount).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(cleanupService.callCount).toBe(2);

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);

    // After stop, additional time does not produce new calls.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cleanupService.callCount).toBe(2);

    const started = logger.records.find(
      (r) => r.msg === 'cleanup_scheduler.started'
    );
    expect(started).toBeDefined();
    expect(started?.obj.intervalMin).toBe(1);
    expect(started?.obj.staleDays).toBe(14);
    expect(started?.obj.sessionRetentionDays).toBe(30);
    expect(started?.obj.artifactsRetentionDays).toBe(7);

    const stopped = logger.records.find(
      (r) => r.msg === 'cleanup_scheduler.stopped'
    );
    expect(stopped).toBeDefined();
  });

  it('double-start is a no-op (logs already_running)', () => {
    const cleanupService = makeService();
    const logger = makeLogger();
    const scheduler = createCleanupScheduler({
      cleanupService,
      logger,
      ...DEFAULT_DEPS,
    });

    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    scheduler.start();
    const already = logger.records.filter(
      (r) => r.msg === 'cleanup_scheduler.already_running'
    );
    expect(already.length).toBe(1);
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
  });

  it('stop() on a non-running scheduler is a no-op', () => {
    const cleanupService = makeService();
    const logger = makeLogger();
    const scheduler = createCleanupScheduler({
      cleanupService,
      logger,
      ...DEFAULT_DEPS,
    });

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
    const stopped = logger.records.find(
      (r) => r.msg === 'cleanup_scheduler.stopped'
    );
    expect(stopped).toBeUndefined();
  });

  it('logs all four injected config values on start', () => {
    const cleanupService = makeService();
    const logger = makeLogger();
    const scheduler = createCleanupScheduler({
      cleanupService,
      logger,
      sweepIntervalMin: 5,
      staleDays: 7,
      sessionRetentionDays: 14,
      artifactsRetentionDays: 3,
    });

    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    const started = logger.records.find(
      (r) => r.msg === 'cleanup_scheduler.started'
    );
    expect(started).toBeDefined();
    expect(started?.obj.intervalMin).toBe(5);
    expect(started?.obj.staleDays).toBe(7);
    expect(started?.obj.sessionRetentionDays).toBe(14);
    expect(started?.obj.artifactsRetentionDays).toBe(3);

    scheduler.stop();
  });
});
