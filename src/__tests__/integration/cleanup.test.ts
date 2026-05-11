/**
 * Integration tests: cleanup-service safety checks against real Supabase + git.
 *
 * Each describe block mints its own fixture set. Triggers (sweep, onPrClosed,
 * removeEnvironment, listBreakdown) live in cleanup-triggers.test.ts.
 */
import 'dotenv/config';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import {
  buildService,
  type CleanupBag,
  divergeBranch,
  type Fixture,
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

afterAll(async () => {
  await runCleanupTeardown(db, cleanup);
  for (const dir of tmpRepos) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  await provider.close();
});

describe('cleanup-service — safety checks', () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await makeFixture(db, 'safety', tmpRepos, cleanup);
  }, 30000);

  beforeEach(async () => {
    // FLX-224: thresholds now live in `config_entry`. Reset to a sane
    // default before each case so an earlier test's `setGlobalConfig`
    // doesn't bleed into the next one. Seven days matches the seed.
    await setGlobalConfig(db, 'cleanup.stale_days', 7);
    await setGlobalConfig(db, 'cleanup.artifacts_retention_days', 30);
  });

  it('uncommitted changes → skip (not-safe)', async () => {
    const { isolation, service } = buildService(db);
    const [subRun] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: subRun.id });

    const env = await isolation.acquire({
      projectId: fx.projectId,
      runId: subRun.id,
      repoPath: fx.repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'cleanup-fixture' },
      branchName: `fluxaos/cleanup-uncommitted-${subRun.id.slice(0, 8)}`,
      baseBranch: 'main',
    });
    cleanup.push({ table: 'isolationEnvironment', id: env.id });

    await writeFile(join(env.workingPath, 'dirty.txt'), 'x');

    const [row] = await db
      .select()
      .from(schema.isolationEnvironment)
      .where(eq(schema.isolationEnvironment.id, env.id));
    const safety = await service.isSafeToRemove(row);
    expect(safety).toEqual({ safe: false, reason: 'uncommitted' });
  });

  it('active-but-not-stale → skip (env fresh, default 7-day threshold)', async () => {
    const { isolation, service } = buildService(db);
    const [subRun] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: subRun.id });

    const env = await isolation.acquire({
      projectId: fx.projectId,
      runId: subRun.id,
      repoPath: fx.repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'cleanup-fixture' },
      branchName: `fluxaos/cleanup-active-${subRun.id.slice(0, 8)}`,
      baseBranch: 'main',
    });
    cleanup.push({ table: 'isolationEnvironment', id: env.id });
    await divergeBranch(env.workingPath);

    const [row] = await db
      .select()
      .from(schema.isolationEnvironment)
      .where(eq(schema.isolationEnvironment.id, env.id));
    const safety = await service.isSafeToRemove(row);
    expect(safety).toEqual({ safe: false, reason: 'active-but-not-stale' });
  });

  it('stale (threshold=1, env aged 2 days) → safe', async () => {
    // FLX-224: positive-integer validator forbids 0; use 1 day and push
    // createdAt back two days to clear it. Verifies the DB-backed gate.
    await setGlobalConfig(db, 'cleanup.stale_days', 1);
    const { isolation, service } = buildService(db);
    const [subRun] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: subRun.id });

    const env = await isolation.acquire({
      projectId: fx.projectId,
      runId: subRun.id,
      repoPath: fx.repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'cleanup-fixture' },
      branchName: `fluxaos/cleanup-stale-${subRun.id.slice(0, 8)}`,
      baseBranch: 'main',
    });
    cleanup.push({ table: 'isolationEnvironment', id: env.id });
    await divergeBranch(env.workingPath);

    // Force created_at two days back so ageDays > 1.
    await db
      .update(schema.isolationEnvironment)
      .set({ createdAt: new Date(Date.now() - 2 * 86_400_000) })
      .where(eq(schema.isolationEnvironment.id, env.id));

    const [row] = await db
      .select()
      .from(schema.isolationEnvironment)
      .where(eq(schema.isolationEnvironment.id, env.id));
    const safety = await service.isSafeToRemove(row);
    expect(safety).toEqual({ safe: true, reason: 'stale' });
  });

  it('open PR for branch → skip (not-safe)', async () => {
    const { isolation, service } = buildService(db);
    const [subRun] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: subRun.id });

    const branch = `fluxaos/cleanup-openpr-${subRun.id.slice(0, 8)}`;
    const env = await isolation.acquire({
      projectId: fx.projectId,
      runId: subRun.id,
      repoPath: fx.repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'cleanup-fixture' },
      branchName: branch,
      baseBranch: 'main',
    });
    cleanup.push({ table: 'isolationEnvironment', id: env.id });
    await divergeBranch(env.workingPath);

    const [pr] = await db
      .insert(schema.issuePullRequest)
      .values({
        issueId: fx.issueId,
        repo: 'fluxaos/cleanup-fixture',
        provider: 'github',
        prNumber: 1,
        prUrl: 'https://example.test/pull/1',
        title: 'wip',
        state: 'open',
        headBranch: branch,
        baseBranch: 'main',
        isPrimary: true,
      })
      .returning();
    cleanup.push({ table: 'issuePullRequest', id: pr.id });

    const [row] = await db
      .select()
      .from(schema.isolationEnvironment)
      .where(eq(schema.isolationEnvironment.id, env.id));
    const safety = await service.isSafeToRemove(row);
    expect(safety).toEqual({ safe: false, reason: 'open-pr' });
  });

  it('merged branch → safe', async () => {
    const { isolation, service } = buildService(db);
    const [subRun] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: subRun.id });

    const branch = `fluxaos/cleanup-merged-${subRun.id.slice(0, 8)}`;
    const env = await isolation.acquire({
      projectId: fx.projectId,
      runId: subRun.id,
      repoPath: fx.repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'cleanup-fixture' },
      branchName: branch,
      baseBranch: 'main',
    });
    cleanup.push({ table: 'isolationEnvironment', id: env.id });

    // Fresh worktree off main: branch tip IS main's commit → merged.
    const [row] = await db
      .select()
      .from(schema.isolationEnvironment)
      .where(eq(schema.isolationEnvironment.id, env.id));
    const safety = await service.isSafeToRemove(row);
    expect(safety).toEqual({ safe: true, reason: 'merged' });
  });
});
