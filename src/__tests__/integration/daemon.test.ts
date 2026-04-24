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
import { and, eq } from 'drizzle-orm';
import { createDaemon, parseEnv } from '@/scripts/daemon';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { pipeline, pipelineRun, pipelineStage, stageRun } from '@/core/db/schema';
import { PIPELINE_RUN_STATUS, STAGE_RUN_STATUS } from '@/core/constants';

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

  it(
    'recoverOnStartup fails stage_runs whose pid is dead',
    async () => {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL required');
      const dbProvider = new SupabaseDatabaseProvider(url);
      const db = dbProvider.getConnection();

      const [pipe] = await db.select().from(pipeline).limit(1);
      if (!pipe) throw new Error('No seeded pipeline; run `npm run db:seed`.');
      const [stage] = await db
        .select()
        .from(pipelineStage)
        .where(eq(pipelineStage.pipelineId, pipe.id))
        .limit(1);
      if (!stage) throw new Error('No seeded pipeline stage.');

      // Dead pid: a very high number that's effectively never a live process.
      const DEAD_PID = 2147483646;

      // Create the daemon FIRST so its own startup-recovery runs against
      // whatever's already in the DB (unrelated). Then seed our stale row
      // and invoke recoverOnStartup manually.
      const daemon = await createDaemon();

      let runId: string | null = null;
      let srId: string | null = null;

      try {
        const [run] = await db
          .insert(pipelineRun)
          .values({
            pipelineId: pipe.id,
            status: PIPELINE_RUN_STATUS.running,
          })
          .returning();
        runId = run.id;

        // attempt high enough to exhaust any reasonable retry budget so
        // recoverOnStartup takes the finishRun (fail) branch instead of
        // launchStage (which would try to spawn a subprocess against a
        // seeded stage with no real repo and hang).
        const [sr] = await db
          .insert(stageRun)
          .values({
            pipelineRunId: run.id,
            pipelineStageId: stage.id,
            status: STAGE_RUN_STATUS.running,
            pid: DEAD_PID,
            attempt: 99,
          })
          .returning();
        srId = sr.id;

        await daemon.orchestrator.recoverOnStartup();

        const [after] = await db
          .select()
          .from(stageRun)
          .where(eq(stageRun.id, sr.id));
        expect(after?.status).toBe(STAGE_RUN_STATUS.failed);
      } finally {
        await daemon.shutdown('test');
        if (srId) {
          await db
            .delete(stageRun)
            .where(and(eq(stageRun.id, srId)))
            .catch(() => undefined);
        }
        if (runId) {
          await db
            .delete(pipelineRun)
            .where(eq(pipelineRun.id, runId))
            .catch(() => undefined);
        }
        await dbProvider.close();
      }
    },
    30_000,
  );
});
