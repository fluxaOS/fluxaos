/**
 * Integration tests: cleanup-scheduler lifecycle.
 *
 * Tests the setInterval harness in isolation. The cleanupService dep is
 * mocked (just a call counter) per the task spec — the DB-backed service
 * is covered in cleanup-triggers.test.ts. Uses vitest fake timers so a
 * sub-minute interval can be exercised without real waiting.
 *
 * FLX-224: scheduler thresholds + interval moved to `config_entry` rows
 * (scope='global', project_id=NULL). The scheduler reads them from the DB
 * via runtime-config accessors; this test exercises that DB-read path by
 * setting rows directly via setGlobalConfig().
 */
import 'dotenv/config';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { createCleanupScheduler } from '@/core/cleanup/cleanup-scheduler';
import type {
  CleanupLogger,
  CleanupReport,
} from '@/core/cleanup/cleanup-service';
import type { Database } from '@/core/db/connection';
import { setGlobalConfig } from './cleanup-fixtures';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

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

describe('cleanup-scheduler', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    // Plant a 1-minute sweep interval so vi.advanceTimersByTimeAsync(60_000)
    // fires exactly one tick. Other thresholds get sane defaults so the
    // accessor reads succeed.
    await setGlobalConfig(db, 'cleanup.sweep_interval_min', 1);
    await setGlobalConfig(db, 'cleanup.stale_days', 14);
    await setGlobalConfig(db, 'cleanup.session_retention_days', 30);
    await setGlobalConfig(db, 'cleanup.artifacts_retention_days', 7);
  });

  afterEach(async () => {
    vi.useRealTimers();
    // Restore seed defaults so other suites see stable rows.
    await setGlobalConfig(db, 'cleanup.sweep_interval_min', 10);
    await setGlobalConfig(db, 'cleanup.stale_days', 7);
    await setGlobalConfig(db, 'cleanup.session_retention_days', 30);
    await setGlobalConfig(db, 'cleanup.artifacts_retention_days', 30);
  });

  afterAll(async () => {
    await provider.close();
  });

  it('starts and fires sweep on interval', async () => {
    vi.useFakeTimers();
    const cleanupService = makeService();
    const logger = makeLogger();
    const scheduler = createCleanupScheduler({
      db,
      cleanupService,
      logger,
    });

    await scheduler.start();

    expect(scheduler.isRunning()).toBe(true);
    expect(cleanupService.callCount).toBe(0); // not called until interval fires

    // 1 minute in ms (matches cleanup.sweep_interval_min = 1).
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
  }, 30_000);

  it('double-start is a no-op (logs already_running)', async () => {
    const cleanupService = makeService();
    const logger = makeLogger();
    const scheduler = createCleanupScheduler({
      db,
      cleanupService,
      logger,
    });

    await scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    await scheduler.start();
    const already = logger.records.filter(
      (r) => r.msg === 'cleanup_scheduler.already_running'
    );
    expect(already.length).toBe(1);
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
  }, 30_000);

  it('stop() on a non-running scheduler is a no-op', () => {
    const cleanupService = makeService();
    const logger = makeLogger();
    const scheduler = createCleanupScheduler({
      db,
      cleanupService,
      logger,
    });

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
    const stopped = logger.records.find(
      (r) => r.msg === 'cleanup_scheduler.stopped'
    );
    expect(stopped).toBeUndefined();
  });

  it('logs the threshold snapshot from DB on start', async () => {
    await setGlobalConfig(db, 'cleanup.sweep_interval_min', 5);
    await setGlobalConfig(db, 'cleanup.stale_days', 8);
    await setGlobalConfig(db, 'cleanup.session_retention_days', 17);
    await setGlobalConfig(db, 'cleanup.artifacts_retention_days', 3);

    const cleanupService = makeService();
    const logger = makeLogger();
    const scheduler = createCleanupScheduler({
      db,
      cleanupService,
      logger,
    });

    await scheduler.start();
    expect(scheduler.isRunning()).toBe(true);

    const started = logger.records.find(
      (r) => r.msg === 'cleanup_scheduler.started'
    );
    expect(started).toBeDefined();
    expect(started?.obj.intervalMin).toBe(5);
    expect(started?.obj.staleDays).toBe(8);
    expect(started?.obj.sessionRetentionDays).toBe(17);
    expect(started?.obj.artifactsRetentionDays).toBe(3);

    scheduler.stop();
  }, 30_000);
});
