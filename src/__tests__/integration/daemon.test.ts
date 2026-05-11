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
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { PIPELINE_RUN_STATUS, STAGE_RUN_STATUS } from '@/core/constants';
import {
  organization,
  pipeline,
  pipelineRun,
  pipelineStage,
  project,
  stageRun,
  user,
} from '@/core/db/schema';
import { createDaemon, loadDaemonEnvFiles, parseEnv } from '@/scripts/daemon';

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
      expect(() => parseEnv()).toThrow(/FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS/);
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

  it('parseEnv rejects suffixed positive integer values', () => {
    process.env.FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS = '120abc';
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

  it('parseEnv rejects suffixed recovery sweep interval values', () => {
    process.env.FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN = '15min';
    try {
      expect(() => parseEnv()).toThrow(/positive integer/);
    } finally {
      delete process.env.FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN;
    }
  });

  it('loads .env.local after .env without overriding existing process env', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fluxaos-daemon-env-'));
    const savedLocalOnly = process.env.FLUXAOS_TEST_LOCAL_ONLY;
    const savedShared = process.env.FLUXAOS_TEST_SHARED;
    try {
      delete process.env.FLUXAOS_TEST_LOCAL_ONLY;
      process.env.FLUXAOS_TEST_SHARED = 'from-process';
      await writeFile(
        join(dir, '.env'),
        'FLUXAOS_TEST_SHARED=from-env\n',
        'utf-8'
      );
      await writeFile(
        join(dir, '.env.local'),
        'FLUXAOS_TEST_LOCAL_ONLY=from-local\nFLUXAOS_TEST_SHARED=from-local\n',
        'utf-8'
      );

      loadDaemonEnvFiles(dir);

      expect(process.env.FLUXAOS_TEST_LOCAL_ONLY).toBe('from-local');
      expect(process.env.FLUXAOS_TEST_SHARED).toBe('from-process');
    } finally {
      if (savedLocalOnly === undefined)
        delete process.env.FLUXAOS_TEST_LOCAL_ONLY;
      else process.env.FLUXAOS_TEST_LOCAL_ONLY = savedLocalOnly;
      if (savedShared === undefined) delete process.env.FLUXAOS_TEST_SHARED;
      else process.env.FLUXAOS_TEST_SHARED = savedShared;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not load daemon env values from dotenv in production mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fluxaos-daemon-prod-env-'));
    const mutableEnv = process.env as Record<string, string | undefined>;
    const savedNodeEnv = process.env.NODE_ENV;
    const savedGrace = process.env.FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS;
    try {
      mutableEnv.NODE_ENV = 'production';
      delete process.env.FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS;
      await writeFile(
        join(dir, '.env'),
        'FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS=3\n',
        'utf-8'
      );

      loadDaemonEnvFiles(dir);

      expect(process.env.FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS).toBeUndefined();
    } finally {
      if (savedNodeEnv === undefined) delete mutableEnv.NODE_ENV;
      else mutableEnv.NODE_ENV = savedNodeEnv;
      if (savedGrace === undefined)
        delete process.env.FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS;
      else process.env.FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS = savedGrace;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('createDaemon starts orchestrator + cleanup scheduler', async () => {
    const daemon = await createDaemon();
    try {
      expect(daemon.orchestrator.running).toBe(true);
      // cleanupScheduler may be enabled or disabled depending on the
      // `cleanup.scheduler_enabled` config_entry row (FLX-224) — don't
      // over-assert.
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

  it('recoverOnStartup fails stage_runs whose pid is dead', async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL required');
    const dbProvider = new SupabaseDatabaseProvider(url);
    const db = dbProvider.getConnection();

    // Build an isolated fixture rather than relying on seeded data so
    // the test doesn't race with other suites that truncate pipelines.
    const stamp = `daemon-recovery-${Date.now()}`;
    const [org] = await db
      .insert(organization)
      .values({ name: stamp, slug: stamp })
      .returning();
    const [userRow] = await db
      .insert(user)
      .values({
        orgId: org.id,
        email: `${stamp}@test.local`,
        name: stamp,
        slug: stamp,
      })
      .returning();
    const [projectRow] = await db
      .insert(project)
      .values({
        orgId: org.id,
        userId: userRow.id,
        name: stamp,
        slug: stamp,
        repoUrl: 'https://github.com/fluxaos/fixture',
        defaultBranch: 'main',
      })
      .returning();
    const [pipe] = await db
      .insert(pipeline)
      .values({ projectId: projectRow.id, name: stamp })
      .returning();
    const [stage] = await db
      .insert(pipelineStage)
      .values({
        pipelineId: pipe.id,
        name: 'research',
        sortOrder: 0,
        driver: 'claude-code',
        gateMode: 'auto',
        maxRetries: 0,
      })
      .returning();

    // Dead pid: a very high number that's effectively never a live process.
    const DEAD_PID = 2147483646;

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
      await db
        .delete(pipelineStage)
        .where(eq(pipelineStage.id, stage.id))
        .catch(() => undefined);
      await db
        .delete(pipeline)
        .where(eq(pipeline.id, pipe.id))
        .catch(() => undefined);
      await db
        .delete(project)
        .where(eq(project.id, projectRow.id))
        .catch(() => undefined);
      await db
        .delete(user)
        .where(eq(user.id, userRow.id))
        .catch(() => undefined);
      await db
        .delete(organization)
        .where(eq(organization.id, org.id))
        .catch(() => undefined);
      await dbProvider.close();
    }
  }, 30_000);
});
