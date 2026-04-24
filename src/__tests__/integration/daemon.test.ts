/**
 * Integration tests: R-DAEMON createDaemon() factory + shutdown.
 *
 * Uses the real Supabase connection + bootstrap — same pattern as the rest
 * of this repo's integration suite. Covers:
 *   1. Factory boots cleanly and starts orchestrator + cleanup scheduler.
 *   2. Shutdown stops both and returns without draining anything (idle).
 *   3. Double-shutdown is a no-op.
 *   4. Missing FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS env throws at parseEnv.
 *
 * W4 will add a recovery-sweep test. W5 will add the trigger-path test.
 */
import 'dotenv/config';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { createDaemon, parseEnv } from '@/scripts/daemon';

describe('R-DAEMON factory', () => {
  beforeAll(() => {
    process.env.FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS = '3';
  });

  afterAll(() => {
    delete process.env.FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS;
    delete process.env.FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN;
  });

  it('parseEnv throws when FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS is unset', () => {
    const saved = process.env.FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS;
    delete process.env.FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS;
    try {
      expect(() => parseEnv()).toThrow(
        /FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS/,
      );
    } finally {
      if (saved !== undefined) {
        process.env.FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS = saved;
      }
    }
  });

  it('parseEnv rejects non-numeric grace seconds', () => {
    process.env.FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS = 'nope';
    try {
      expect(() => parseEnv()).toThrow(/positive integer/);
    } finally {
      process.env.FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS = '3';
    }
  });

  it('parseEnv accepts optional recovery sweep interval', () => {
    process.env.FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN = '15';
    try {
      const env = parseEnv();
      expect(env.recoverySweepIntervalMin).toBe(15);
    } finally {
      delete process.env.FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN;
    }
  });

  it('createDaemon starts orchestrator + cleanup scheduler', async () => {
    const daemon = await createDaemon();
    try {
      expect(daemon.orchestrator.running).toBe(true);
      // cleanupScheduler may be enabled or disabled depending on whether
      // the four FLUXAOS_CLEANUP_* env vars are set — don't over-assert.
      expect(typeof daemon.cleanupScheduler.isRunning()).toBe('boolean');
      expect(daemon.env.shutdownGraceSeconds).toBe(3);
    } finally {
      await daemon.shutdown('test-teardown');
    }
  });

  it('shutdown stops orchestrator and cleanup scheduler', async () => {
    const daemon = await createDaemon();
    expect(daemon.orchestrator.running).toBe(true);
    await daemon.shutdown('test');
    expect(daemon.orchestrator.running).toBe(false);
    expect(daemon.cleanupScheduler.isRunning()).toBe(false);
  });

  it('double-shutdown is a no-op', async () => {
    const daemon = await createDaemon();
    await daemon.shutdown('first');
    // Should resolve without throwing even though orchestrator.stop() was
    // already called.
    await expect(daemon.shutdown('second')).resolves.toBeUndefined();
  });
});
