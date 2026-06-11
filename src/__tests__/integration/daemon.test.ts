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
import { and, eq, inArray, isNotNull, notInArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import {
  PIPELINE_RUN_STATUS,
  PIPELINE_RUN_TERMINAL,
  STAGE_RUN_STATUS,
} from '@/core/constants';
import {
  issue,
  organization,
  pipeline,
  pipelineRun,
  pipelineStage,
  project,
  projectMember,
  stageRun,
  team,
  user,
} from '@/core/db/schema';
import { createDaemon, loadDaemonEnvFiles, parseEnv } from '@/scripts/daemon';

describe('R-DAEMON factory', () => {
  // FLX-278/FLX-275 — data isolation from auto-dispatch. createDaemon()
  // boots a REAL IssueWatcher whose startup sweep dispatches every open
  // issue in an auto-dispatch-enabled project (defaultPipelineId set) that
  // has no active pipeline_run — i.e. the seeded issues. Each createDaemon
  // call in this suite would therefore launch real pipeline executions
  // that outlive the suite (the in-process daemon is torn down mid-flight),
  // leaving zombie 'running' rows that starve the global concurrency slots
  // for every later suite. Block dispatch with DATA, not by stubbing: a
  // 'queued' pipeline_run is non-terminal (trips the watcher's
  // active-run-exists guard) but is never claimed by any orchestrator
  // (only 'pending' is) and never counts toward the running-slot limit.
  const blockerProvider = new SupabaseDatabaseProvider(
    process.env.DATABASE_URL as string
  );
  const blockerDb = blockerProvider.getConnection();
  const blockerRunIds: string[] = [];

  beforeAll(async () => {
    process.env.FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS = '3';

    const openIssues = await blockerDb
      .select({
        id: issue.id,
        defaultPipelineId: project.defaultPipelineId,
      })
      .from(issue)
      .innerJoin(project, eq(issue.projectId, project.id))
      .where(
        and(eq(issue.isClosed, false), isNotNull(project.defaultPipelineId))
      );
    for (const row of openIssues) {
      const active = await blockerDb
        .select({ id: pipelineRun.id })
        .from(pipelineRun)
        .where(
          and(
            eq(pipelineRun.issueId, row.id),
            notInArray(pipelineRun.status, [...PIPELINE_RUN_TERMINAL])
          )
        );
      if (active.length > 0) continue;
      const [blocker] = await blockerDb
        .insert(pipelineRun)
        .values({
          // defaultPipelineId is non-null per the join filter above.
          pipelineId: row.defaultPipelineId as string,
          issueId: row.id,
          status: PIPELINE_RUN_STATUS.queued,
        })
        .returning();
      blockerRunIds.push(blocker.id);
    }
  });

  afterAll(async () => {
    delete process.env.FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS;
    delete process.env.FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN;
    if (blockerRunIds.length > 0) {
      await blockerDb
        .delete(pipelineRun)
        .where(inArray(pipelineRun.id, blockerRunIds));
    }
    await blockerProvider.close();
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
    // 30s: createDaemon awaits the recovery sweep + real Supabase Realtime
    // channel subscriptions — the handshake alone can exceed the 5s default.
  }, 30_000);

  it('shutdown stops orchestrator and cleanup scheduler', async () => {
    const daemon = await createDaemon();
    expect(daemon.orchestrator.running).toBe(true);
    await daemon.shutdown('test');
    expect(daemon.orchestrator.running).toBe(false);
    expect(daemon.cleanupScheduler.isRunning()).toBe(false);
  }, 30_000);

  it('double-shutdown is a no-op', async () => {
    const daemon = await createDaemon();
    await daemon.shutdown('first');
    // Should resolve without throwing even though orchestrator.stop() was
    // already called.
    await expect(daemon.shutdown('second')).resolves.toBeUndefined();
  }, 30_000);

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
      .values({ name: stamp })
      .returning();
    const [userRow] = await db
      .insert(user)
      .values({
        orgId: org.id,
        email: `${stamp}@test.local`,
        name: stamp,
      })
      .returning();
    const [teamRow] = await db
      .insert(team)
      .values({ orgId: org.id, name: `${stamp}-team` })
      .returning();
    const [projectRow] = await db
      .insert(project)
      .values({
        orgId: org.id,
        teamId: teamRow.id,
        name: stamp,
        repoUrl: 'https://github.com/fluxaos/fixture',
        defaultBranch: 'main',
      })
      .returning();
    await db
      .insert(projectMember)
      .values({ userId: userRow.id, projectId: projectRow.id });
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
