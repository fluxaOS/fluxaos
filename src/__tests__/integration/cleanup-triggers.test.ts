/**
 * Integration tests: cleanup-service triggers against real Supabase + git.
 *
 * Covers runScheduledSweep, onPrClosed, removeEnvironment({ force }), and
 * listBreakdown. Safety-check pipeline lives in cleanup.test.ts.
 */
import 'dotenv/config';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import {
  buildService,
  type CleanupBag,
  divergeBranch,
  makeFixture,
  runCleanupTeardown,
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

describe('cleanup-service — triggers', () => {
  beforeEach(() => {
    delete process.env.FLUXAOS_CLEANUP_STALE_DAYS;
  });

  it('runScheduledSweep reaps merged branches and stale envs; skips unsafe', async () => {
    process.env.FLUXAOS_CLEANUP_STALE_DAYS = '0';

    const fx = await makeFixture(db, 'sweep', tmpRepos, cleanup);
    const { isolation, service } = buildService(db);

    // Env #1: merged (branch is reachable from main; no divergence).
    const [run1] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run1.id });
    const env1 = await isolation.acquire({
      projectId: fx.projectId,
      runId: run1.id,
      repoPath: fx.repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'cleanup-sweep' },
      branchName: `fluxaos/sweep-merged-${run1.id.slice(0, 8)}`,
    });
    cleanup.push({ table: 'isolationEnvironment', id: env1.id });

    // Env #2: uncommitted changes (should skip).
    const [run2] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run2.id });
    const env2 = await isolation.acquire({
      projectId: fx.projectId,
      runId: run2.id,
      repoPath: fx.repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'cleanup-sweep' },
      branchName: `fluxaos/sweep-dirty-${run2.id.slice(0, 8)}`,
    });
    cleanup.push({ table: 'isolationEnvironment', id: env2.id });
    await writeFile(join(env2.workingPath, 'dirty.txt'), 'x');

    // Env #3: open PR (should skip); divergence so "merged" doesn't fire first.
    const [run3] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run3.id });
    const branch3 = `fluxaos/sweep-openpr-${run3.id.slice(0, 8)}`;
    const env3 = await isolation.acquire({
      projectId: fx.projectId,
      runId: run3.id,
      repoPath: fx.repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'cleanup-sweep' },
      branchName: branch3,
    });
    cleanup.push({ table: 'isolationEnvironment', id: env3.id });
    await divergeBranch(env3.workingPath);

    const [pr3] = await db
      .insert(schema.issuePullRequest)
      .values({
        issueId: fx.issueId,
        repo: 'fluxaos/cleanup-sweep',
        provider: 'github',
        prNumber: 42,
        prUrl: 'https://example.test/pull/42',
        title: 'wip',
        state: 'open',
        headBranch: branch3,
        baseBranch: 'main',
        isPrimary: true,
      })
      .returning();
    cleanup.push({ table: 'issuePullRequest', id: pr3.id });

    const report = await service.runScheduledSweep();

    const removedIds = new Set(report.removed.map((r) => r.envId));
    const skippedByEnv = new Map(
      report.skipped.map((s) => [s.envId, s.reason])
    );

    expect(removedIds.has(env1.id)).toBe(true);
    expect(skippedByEnv.get(env2.id)).toBe('uncommitted');
    expect(skippedByEnv.get(env3.id)).toBe('open-pr');
  }, 60000);

  it('onPrClosed({ merged: true }) releases the env for that branch', async () => {
    const fx = await makeFixture(db, 'prclosed', tmpRepos, cleanup);
    const { isolation, service } = buildService(db);

    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run.id });

    const branch = `fluxaos/prclosed-${run.id.slice(0, 8)}`;
    const env = await isolation.acquire({
      projectId: fx.projectId,
      runId: run.id,
      repoPath: fx.repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'cleanup-prclosed' },
      branchName: branch,
    });
    cleanup.push({ table: 'isolationEnvironment', id: env.id });

    const [pr] = await db
      .insert(schema.issuePullRequest)
      .values({
        issueId: fx.issueId,
        repo: 'fluxaos/cleanup-prclosed',
        provider: 'github',
        prNumber: 7,
        prUrl: 'https://example.test/pull/7',
        title: 'done',
        state: 'merged',
        headBranch: branch,
        baseBranch: 'main',
        isPrimary: true,
      })
      .returning();
    cleanup.push({ table: 'issuePullRequest', id: pr.id });

    await service.onPrClosed(7, 'fluxaos/cleanup-prclosed', { merged: true });

    const [after] = await db
      .select()
      .from(schema.isolationEnvironment)
      .where(eq(schema.isolationEnvironment.id, env.id));
    expect(after.status).toBe('inactive');
  }, 30000);

  it('removeEnvironment({ force: true }) bypasses safety checks', async () => {
    const fx = await makeFixture(db, 'force', tmpRepos, cleanup);
    const { isolation, service } = buildService(db);

    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run.id });

    const env = await isolation.acquire({
      projectId: fx.projectId,
      runId: run.id,
      repoPath: fx.repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'cleanup-force' },
      branchName: `fluxaos/force-${run.id.slice(0, 8)}`,
    });
    cleanup.push({ table: 'isolationEnvironment', id: env.id });

    // Dirty the worktree so non-force path would block.
    await writeFile(join(env.workingPath, 'dirty.txt'), 'x');

    const result = await service.removeEnvironment(env.id, { force: true });
    expect(result.worktreeRemoved).toBe(true);

    const [after] = await db
      .select()
      .from(schema.isolationEnvironment)
      .where(eq(schema.isolationEnvironment.id, env.id));
    expect(after.status).toBe('inactive');
  }, 30000);

  it('listBreakdown returns correct counts', async () => {
    const fx = await makeFixture(db, 'breakdown', tmpRepos, cleanup);
    const { isolation, service } = buildService(db);

    const [run1] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run1.id });
    const active1 = await isolation.acquire({
      projectId: fx.projectId,
      runId: run1.id,
      repoPath: fx.repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'cleanup-breakdown' },
      branchName: `fluxaos/breakdown-a-${run1.id.slice(0, 8)}`,
    });
    cleanup.push({ table: 'isolationEnvironment', id: active1.id });

    const [run2] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run2.id });
    const active2 = await isolation.acquire({
      projectId: fx.projectId,
      runId: run2.id,
      repoPath: fx.repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'cleanup-breakdown' },
      branchName: `fluxaos/breakdown-b-${run2.id.slice(0, 8)}`,
    });
    cleanup.push({ table: 'isolationEnvironment', id: active2.id });

    // Release one so inactiveCount > 0.
    await isolation.release(active2.id);

    const breakdown = await service.listBreakdown({ projectId: fx.projectId });
    expect(breakdown.totalActive).toBe(1);
    expect(breakdown.totalInactive).toBe(1);
    // Fresh branches off main are "merged" → safeToRemove=1.
    expect(breakdown.safeToRemove).toBe(1);
  }, 30000);
});
