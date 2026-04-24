/**
 * Integration tests: cleanup-scheduler lifecycle.
 *
 * Tests the setInterval harness in isolation. The cleanupService dep is
 * mocked (just a call counter) per the task spec — the DB-backed service
 * is covered in cleanup-triggers.test.ts. Uses vitest fake timers so a
 * 1-minute interval can be exercised without waiting.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  ARTIFACTS_RETENTION_ENV,
  createCleanupScheduler,
  SESSION_RETENTION_ENV,
  STALE_DAYS_ENV,
  SWEEP_INTERVAL_ENV,
} from '@/core/cleanup/cleanup-scheduler';
import type { CleanupLogger, CleanupReport } from '@/core/cleanup/cleanup-service';

function makeLogger(): CleanupLogger & {
  records: { level: string; obj: Record<string, unknown>; msg?: string }[];
} {
  const records: { level: string; obj: Record<string, unknown>; msg?: string }[] =
    [];
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

describe('cleanup-scheduler', () => {
  beforeEach(() => {
    delete process.env[SWEEP_INTERVAL_ENV];
    delete process.env[STALE_DAYS_ENV];
    delete process.env[SESSION_RETENTION_ENV];
    delete process.env[ARTIFACTS_RETENTION_ENV];
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env[SWEEP_INTERVAL_ENV];
    delete process.env[STALE_DAYS_ENV];
    delete process.env[SESSION_RETENTION_ENV];
    delete process.env[ARTIFACTS_RETENTION_ENV];
  });

  it('refuses to start when required env vars are missing', () => {
    const cleanupService = makeService();
    const logger = makeLogger();
    const scheduler = createCleanupScheduler({ cleanupService, logger });

    scheduler.start();

    expect(scheduler.isRunning()).toBe(false);
    expect(cleanupService.callCount).toBe(0);
    const warn = logger.records.find(
      (r) =>
        r.level === 'warn' && r.msg === 'cleanup_scheduler.disabled_missing_env'
    );
    expect(warn).toBeDefined();
    const missing = (warn?.obj.missing ?? []) as string[];
    expect(missing).toContain(SWEEP_INTERVAL_ENV);
    expect(missing).toContain(STALE_DAYS_ENV);
    expect(missing).toContain(SESSION_RETENTION_ENV);
    expect(missing).toContain(ARTIFACTS_RETENTION_ENV);
  });

  it('refuses to start when a var is unparseable', () => {
    process.env[SWEEP_INTERVAL_ENV] = 'nope';
    process.env[STALE_DAYS_ENV] = '14';
    process.env[SESSION_RETENTION_ENV] = '30';
    process.env[ARTIFACTS_RETENTION_ENV] = '7';

    const cleanupService = makeService();
    const logger = makeLogger();
    const scheduler = createCleanupScheduler({ cleanupService, logger });

    scheduler.start();

    expect(scheduler.isRunning()).toBe(false);
    const warn = logger.records.find(
      (r) => r.msg === 'cleanup_scheduler.disabled_missing_env'
    );
    expect(warn).toBeDefined();
    expect((warn?.obj.missing as string[])).toEqual([SWEEP_INTERVAL_ENV]);
  });

  it('starts when all four env vars are set; fires sweep on interval', async () => {
    process.env[SWEEP_INTERVAL_ENV] = '1';
    process.env[STALE_DAYS_ENV] = '14';
    process.env[SESSION_RETENTION_ENV] = '30';
    process.env[ARTIFACTS_RETENTION_ENV] = '7';

    vi.useFakeTimers();
    const cleanupService = makeService();
    const logger = makeLogger();
    const scheduler = createCleanupScheduler({ cleanupService, logger });

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
    const stopped = logger.records.find(
      (r) => r.msg === 'cleanup_scheduler.stopped'
    );
    expect(stopped).toBeDefined();
  });

  it('double-start is a no-op (logs already_running)', () => {
    process.env[SWEEP_INTERVAL_ENV] = '1';
    process.env[STALE_DAYS_ENV] = '14';
    process.env[SESSION_RETENTION_ENV] = '30';
    process.env[ARTIFACTS_RETENTION_ENV] = '7';

    const cleanupService = makeService();
    const logger = makeLogger();
    const scheduler = createCleanupScheduler({ cleanupService, logger });

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
    const scheduler = createCleanupScheduler({ cleanupService, logger });

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
    const stopped = logger.records.find(
      (r) => r.msg === 'cleanup_scheduler.stopped'
    );
    expect(stopped).toBeUndefined();
  });

  // ── R-ARTIFACTS W4 — 4th env var required ──────────────────────────────

  it('starts when all 4 env vars (including ARTIFACTS_RETENTION_ENV) are set', () => {
    process.env[SWEEP_INTERVAL_ENV] = '1';
    process.env[STALE_DAYS_ENV] = '14';
    process.env[SESSION_RETENTION_ENV] = '30';
    process.env[ARTIFACTS_RETENTION_ENV] = '7';

    const cleanupService = makeService();
    const logger = makeLogger();
    const scheduler = createCleanupScheduler({ cleanupService, logger });

    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    const started = logger.records.find(
      (r) => r.msg === 'cleanup_scheduler.started'
    );
    expect(started).toBeDefined();
    expect(started?.obj.artifactsRetentionDays).toBe(7);

    scheduler.stop();
  });

  it('refuses to start when only ARTIFACTS_RETENTION_ENV is missing', () => {
    process.env[SWEEP_INTERVAL_ENV] = '1';
    process.env[STALE_DAYS_ENV] = '14';
    process.env[SESSION_RETENTION_ENV] = '30';
    // ARTIFACTS_RETENTION_ENV intentionally unset.

    const cleanupService = makeService();
    const logger = makeLogger();
    const scheduler = createCleanupScheduler({ cleanupService, logger });

    scheduler.start();

    expect(scheduler.isRunning()).toBe(false);
    const warn = logger.records.find(
      (r) =>
        r.level === 'warn' && r.msg === 'cleanup_scheduler.disabled_missing_env'
    );
    expect(warn).toBeDefined();
    const missing = (warn?.obj.missing ?? []) as string[];
    expect(missing).toEqual([ARTIFACTS_RETENTION_ENV]);
  });
});
