/**
 * Integration tests — R-ARTIFACTS W7-T15 cleanup sweep against real FS.
 *
 * The sibling `cleanup-artifacts.test.ts` (W4) exercises the sweep with
 * `vi.fn()` stubs for the artifacts filesystem helpers. This test is
 * deeper: it provisions real on-disk artifact directories inside a tmp
 * root, backdates mtimes with `fs.utimes`, and runs the sweep through
 * the REAL `src/adapters/fs/artifacts.ts` helpers so both layers are
 * exercised end-to-end (DB discovery → FS list → stat → rm).
 *
 * 4 assertions:
 *   1. Stale terminal (completed + mtime > retention) → reaped.
 *   2. Young terminal (completed + mtime < retention) → preserved.
 *   3. Non-terminal (running + any mtime) → preserved.
 *   4. Multi-dir sweep: 3 dirs (stale-term, young-term, non-term) → only
 *      the stale-terminal one is reaped; the other two remain.
 *
 * Retention is set via `setGlobalConfig(db, 'cleanup.artifacts_retention_days', 1)`
 * in `beforeEach` and restored to the seeded default in `afterEach` so
 * nothing leaks between tests or into the rest of the suite. The product
 * code reads the row from `config_entry` (FLX-224 migrated the env var to
 * DB-backed config) — no test-only numeric thresholds are baked into
 * runtime code (AGENT_BEHAVIOR.md: no invented numeric thresholds).
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getArtifactsDirAge,
  listArtifactDirs,
  removeArtifactsDir,
} from '@/adapters/fs';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import {
  buildService,
  type CleanupBag,
  makeFixture,
  runCleanupTeardown,
  setGlobalConfig,
} from './cleanup-fixtures';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

const cleanup: CleanupBag[] = [];
const tmpRepos: string[] = [];
const tmpArtifactBases: string[] = [];

afterAll(async () => {
  await runCleanupTeardown(db, cleanup);
  for (const dir of tmpRepos) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  for (const dir of tmpArtifactBases) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  await provider.close();
});

/**
 * Create an artifacts base dir at `tmpdir()` and register it for teardown.
 * Each test gets a unique base so the sweep's base-discovery (DISTINCT
 * `dirname(isolation_environment.artifacts_path)`) isolates to this test.
 */
async function makeArtifactsBase(label: string): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), `fluxaos-artifacts-${label}-`));
  tmpArtifactBases.push(base);
  return base;
}

/**
 * FLX-275 — confine the sweep's filesystem surface to bases THIS suite owns.
 *
 * `runScheduledSweep` is global by design: it discovers every artifacts base
 * recorded on any isolation_environment row. In the real-world gate
 * environment the live daemon has env rows pointing at the operator's
 * in-repo `.fluxaos-artifacts/` base, which accumulates hundreds of
 * historical run dirs (on NFS). With this suite's 1-day retention override,
 * the sweep would stat + DB-check + `rm -rf` every one of them — minutes of
 * I/O (the observed 30s timeouts scale with data volume) and destruction of
 * artifacts the suite does not own. Listing only owned bases keeps the
 * real-FS pipeline (readdir → stat → rm) fully exercised on the dirs the
 * test provisioned while making foreign bases invisible — the same view a
 * pristine DB would present.
 */
function listOwnedArtifactDirs(base: string): Promise<string[]> {
  if (!tmpArtifactBases.includes(base)) return Promise.resolve([]);
  return listArtifactDirs(base);
}

/** Backdated mtime for "stale" cases — 2 days old (exceeds 1-day retention). */
function staleDate(): Date {
  return new Date(Date.now() - 2 * 86_400_000);
}

/** Fresh mtime — "now" (well within 1-day retention). */
function freshDate(): Date {
  return new Date();
}

/**
 * Provision an on-disk artifacts dir for a given run and record it on the
 * isolation_environment row so the sweep's base discovery finds it.
 *
 * Returns the absolute path to the created dir.
 */
async function provisionArtifactsDir(opts: {
  base: string;
  runId: string;
  projectId: string;
  branchLabel: string;
  status: 'active' | 'inactive';
  mtime: Date;
}): Promise<string> {
  const dir = join(opts.base, opts.runId);
  await mkdir(dir, { recursive: true });
  await utimes(dir, opts.mtime, opts.mtime);

  const [envRow] = await db
    .insert(schema.isolationEnvironment)
    .values({
      projectId: opts.projectId,
      runId: opts.runId,
      provider: 'worktree',
      workingPath: `/tmp/fake-worktree-${opts.branchLabel}`,
      branchName: `fluxaos/${opts.branchLabel}-${opts.runId.slice(0, 8)}`,
      status: opts.status,
      metadata: {},
      artifactsPath: dir,
    })
    .returning();
  cleanup.push({ table: 'isolationEnvironment', id: envRow.id });

  return dir;
}

describe('cleanup-service — artifacts sweep against real FS (R-ARTIFACTS W7-T15)', () => {
  beforeEach(async () => {
    // FLX-224: retention now in `config_entry`. Also seed stale_days so
    // isSafeToRemove() doesn't throw on its DB read.
    await setGlobalConfig(db, 'cleanup.artifacts_retention_days', 1);
    await setGlobalConfig(db, 'cleanup.stale_days', 7);
  });

  afterEach(async () => {
    // Restore seed default value.
    await setGlobalConfig(db, 'cleanup.artifacts_retention_days', 30);
  });

  it('reaps stale terminal artifact dir (mtime older than retention)', async () => {
    const fx = await makeFixture(db, 't15-stale', tmpRepos, cleanup);
    const base = await makeArtifactsBase('t15-stale');

    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'completed' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run.id });

    const dir = await provisionArtifactsDir({
      base,
      runId: run.id,
      projectId: fx.projectId,
      branchLabel: 't15-stale',
      status: 'inactive',
      mtime: staleDate(),
    });

    expect(existsSync(dir)).toBe(true);

    const { service } = buildService(db, {
      listArtifactDirs: listOwnedArtifactDirs,
      removeArtifactsDir,
      getArtifactsDirAge,
    });
    await service.runScheduledSweep();

    expect(existsSync(dir)).toBe(false);
  }, 30000);

  it('leaves young terminal artifact dir alone (mtime within retention)', async () => {
    const fx = await makeFixture(db, 't15-young', tmpRepos, cleanup);
    const base = await makeArtifactsBase('t15-young');

    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'completed' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run.id });

    const dir = await provisionArtifactsDir({
      base,
      runId: run.id,
      projectId: fx.projectId,
      branchLabel: 't15-young',
      status: 'inactive',
      mtime: freshDate(),
    });

    const { service } = buildService(db, {
      listArtifactDirs: listOwnedArtifactDirs,
      removeArtifactsDir,
      getArtifactsDirAge,
    });
    await service.runScheduledSweep();

    expect(existsSync(dir)).toBe(true);
  }, 30000);

  it('leaves non-terminal artifact dir alone regardless of age', async () => {
    const fx = await makeFixture(db, 't15-active', tmpRepos, cleanup);
    const base = await makeArtifactsBase('t15-active');

    // Non-terminal run, but age is well past retention.
    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'running' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run.id });

    const dir = await provisionArtifactsDir({
      base,
      runId: run.id,
      projectId: fx.projectId,
      branchLabel: 't15-active',
      status: 'active',
      mtime: staleDate(),
    });

    const { service } = buildService(db, {
      listArtifactDirs: listOwnedArtifactDirs,
      removeArtifactsDir,
      getArtifactsDirAge,
    });
    await service.runScheduledSweep();

    expect(existsSync(dir)).toBe(true);
  }, 30000);

  it('multi-dir sweep reaps only the stale terminal dir, preserving the others', async () => {
    const fx = await makeFixture(db, 't15-multi', tmpRepos, cleanup);
    const base = await makeArtifactsBase('t15-multi');

    // 1 — stale terminal (should be reaped)
    const [runStale] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'completed' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: runStale.id });
    const dirStale = await provisionArtifactsDir({
      base,
      runId: runStale.id,
      projectId: fx.projectId,
      branchLabel: 't15-multi-stale',
      status: 'inactive',
      mtime: staleDate(),
    });

    // 2 — young terminal (should be preserved)
    const [runYoung] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'completed' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: runYoung.id });
    const dirYoung = await provisionArtifactsDir({
      base,
      runId: runYoung.id,
      projectId: fx.projectId,
      branchLabel: 't15-multi-young',
      status: 'inactive',
      mtime: freshDate(),
    });

    // 3 — non-terminal, ignore age (should be preserved)
    const [runActive] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'running' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: runActive.id });
    const dirActive = await provisionArtifactsDir({
      base,
      runId: runActive.id,
      projectId: fx.projectId,
      branchLabel: 't15-multi-active',
      status: 'active',
      mtime: staleDate(),
    });

    const { service } = buildService(db, {
      listArtifactDirs: listOwnedArtifactDirs,
      removeArtifactsDir,
      getArtifactsDirAge,
    });
    await service.runScheduledSweep();

    expect(existsSync(dirStale)).toBe(false);
    expect(existsSync(dirYoung)).toBe(true);
    expect(existsSync(dirActive)).toBe(true);
  }, 30000);
});
