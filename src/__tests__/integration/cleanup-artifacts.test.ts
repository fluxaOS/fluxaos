/**
 * Integration tests — R-ARTIFACTS W4 cleanup service artifacts reaping.
 *
 * Covers:
 *   - runScheduledSweep() reaps stale artifact dirs (terminal + aged).
 *   - runScheduledSweep() leaves non-terminal pipeline_run artifacts alone.
 *   - runScheduledSweep() leaves terminal-but-young artifacts alone.
 *   - removeEnvironment({force:true}) removes the env's artifacts dir.
 *   - onPrClosed() does NOT remove artifacts dirs (only worktrees).
 *
 * Uses real Supabase for DB state; artifacts filesystem helpers are injected
 * as vi.fn() fakes so the tests don't depend on W2 having landed yet.
 */
import 'dotenv/config';
import { rm } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
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
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import {
  type ArtifactsFakes,
  buildService,
  type CleanupBag,
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

describe('cleanup-service — artifacts reaping (R-ARTIFACTS W4)', () => {
  const ARTIFACTS_BASE = '/tmp/fluxaos-artifacts-test-base';
  const RETENTION_DAYS = '7';

  beforeEach(() => {
    process.env.FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS = RETENTION_DAYS;
  });

  afterEach(() => {
    delete process.env.FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS;
  });

  it('scheduled sweep reaps stale artifact dir when pipeline_run is terminal', async () => {
    const fx = await makeFixture(db, 'art-stale', tmpRepos, cleanup);

    // Terminal run at a known runId; the dir basename IS the runId.
    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'completed' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run.id });

    // Record an artifacts_path so listArtifactsBases() discovers the base.
    const artifactsPath = `${ARTIFACTS_BASE}/${run.id}`;
    const [envRow] = await db
      .insert(schema.isolationEnvironment)
      .values({
        projectId: fx.projectId,
        runId: run.id,
        provider: 'worktree',
        workingPath: '/tmp/fake-worktree-stale',
        branchName: `fluxaos/art-stale-${run.id.slice(0, 8)}`,
        status: 'inactive',
        metadata: {},
        artifactsPath,
      })
      .returning();
    cleanup.push({ table: 'isolationEnvironment', id: envRow.id });

    // mtime: 30 days old → exceeds the 7-day retention window.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

    const artifactsFakes: ArtifactsFakes = {
      listArtifactDirs: vi.fn(async (base: string) => {
        if (base === ARTIFACTS_BASE) return [artifactsPath];
        return [];
      }),
      getArtifactsDirAge: vi.fn(async () => thirtyDaysAgo),
      removeArtifactsDir: vi.fn(async () => undefined),
    };
    const { service } = buildService(db, artifactsFakes);

    await service.runScheduledSweep();

    expect(artifactsFakes.removeArtifactsDir).toHaveBeenCalledWith(
      artifactsPath
    );
  }, 30000);

  it('scheduled sweep leaves non-terminal pipeline_run artifact dir alone', async () => {
    const fx = await makeFixture(db, 'art-active', tmpRepos, cleanup);

    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'running' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run.id });

    const artifactsPath = `${ARTIFACTS_BASE}/${run.id}`;
    const [envRow] = await db
      .insert(schema.isolationEnvironment)
      .values({
        projectId: fx.projectId,
        runId: run.id,
        provider: 'worktree',
        workingPath: '/tmp/fake-worktree-active',
        branchName: `fluxaos/art-active-${run.id.slice(0, 8)}`,
        status: 'active',
        metadata: {},
        artifactsPath,
      })
      .returning();
    cleanup.push({ table: 'isolationEnvironment', id: envRow.id });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

    const artifactsFakes: ArtifactsFakes = {
      listArtifactDirs: vi.fn(async (base: string) =>
        base === ARTIFACTS_BASE ? [artifactsPath] : []
      ),
      getArtifactsDirAge: vi.fn(async () => thirtyDaysAgo),
      removeArtifactsDir: vi.fn(async () => undefined),
    };
    const { service } = buildService(db, artifactsFakes);

    await service.runScheduledSweep();

    expect(artifactsFakes.removeArtifactsDir).not.toHaveBeenCalled();
  }, 30000);

  it('scheduled sweep leaves terminal-but-young artifact dir alone', async () => {
    const fx = await makeFixture(db, 'art-young', tmpRepos, cleanup);

    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'completed' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run.id });

    const artifactsPath = `${ARTIFACTS_BASE}/${run.id}`;
    const [envRow] = await db
      .insert(schema.isolationEnvironment)
      .values({
        projectId: fx.projectId,
        runId: run.id,
        provider: 'worktree',
        workingPath: '/tmp/fake-worktree-young',
        branchName: `fluxaos/art-young-${run.id.slice(0, 8)}`,
        status: 'inactive',
        metadata: {},
        artifactsPath,
      })
      .returning();
    cleanup.push({ table: 'isolationEnvironment', id: envRow.id });

    // 1 day old — well within 7-day retention.
    const oneDayAgo = new Date(Date.now() - 86_400_000);

    const artifactsFakes: ArtifactsFakes = {
      listArtifactDirs: vi.fn(async (base: string) =>
        base === ARTIFACTS_BASE ? [artifactsPath] : []
      ),
      getArtifactsDirAge: vi.fn(async () => oneDayAgo),
      removeArtifactsDir: vi.fn(async () => undefined),
    };
    const { service } = buildService(db, artifactsFakes);

    await service.runScheduledSweep();

    expect(artifactsFakes.removeArtifactsDir).not.toHaveBeenCalled();
  }, 30000);

  it('removeEnvironment({force: true}) removes the artifacts dir recorded on the env row', async () => {
    const fx = await makeFixture(db, 'art-force', tmpRepos, cleanup);
    const artifactsFakes: ArtifactsFakes = {
      removeArtifactsDir: vi.fn(async () => undefined),
    };
    const { isolation, service } = buildService(db, artifactsFakes);

    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run.id });

    const env = await isolation.acquire({
      projectId: fx.projectId,
      runId: run.id,
      repoPath: fx.repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'cleanup-art-force' },
      branchName: `fluxaos/art-force-${run.id.slice(0, 8)}`,
    });
    cleanup.push({ table: 'isolationEnvironment', id: env.id });

    // Stamp an artifacts_path on the env row so force-remove can find it.
    const artifactsPath = `${ARTIFACTS_BASE}/${run.id}`;
    await db
      .update(schema.isolationEnvironment)
      .set({ artifactsPath })
      .where(eq(schema.isolationEnvironment.id, env.id));

    const result = await service.removeEnvironment(env.id, { force: true });
    expect(result.worktreeRemoved).toBe(true);
    expect(artifactsFakes.removeArtifactsDir).toHaveBeenCalledWith(
      artifactsPath
    );
  }, 30000);

  it('onPrClosed does NOT remove artifact dirs (only worktrees)', async () => {
    const fx = await makeFixture(db, 'art-pr', tmpRepos, cleanup);

    // onPrClosed with { merged: false } → non-force path for non-merged
    // PRs leaves the worktree intact AND must not touch artifacts either.
    // We use merged:false so removeEnvironment is called with force:false
    // and no force-remove-artifacts branch is triggered.
    const artifactsFakes: ArtifactsFakes = {
      removeArtifactsDir: vi.fn(async () => undefined),
      listArtifactDirs: vi.fn(async () => []),
    };
    const { isolation, service } = buildService(db, artifactsFakes);

    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: fx.pipelineId, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run.id });

    const branch = `fluxaos/art-pr-${run.id.slice(0, 8)}`;
    const env = await isolation.acquire({
      projectId: fx.projectId,
      runId: run.id,
      repoPath: fx.repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'cleanup-art-pr' },
      branchName: branch,
    });
    cleanup.push({ table: 'isolationEnvironment', id: env.id });

    // Stamp an artifacts_path on the env row to show that a path exists
    // but must NOT be removed.
    const artifactsPath = `${ARTIFACTS_BASE}/${run.id}`;
    await db
      .update(schema.isolationEnvironment)
      .set({ artifactsPath })
      .where(eq(schema.isolationEnvironment.id, env.id));

    const [pr] = await db
      .insert(schema.issuePullRequest)
      .values({
        issueId: fx.issueId,
        repo: 'fluxaos/cleanup-art-pr',
        provider: 'github',
        prNumber: 101,
        prUrl: 'https://example.test/pull/101',
        title: 'closed unmerged',
        state: 'closed',
        headBranch: branch,
        baseBranch: 'main',
        isPrimary: true,
      })
      .returning();
    cleanup.push({ table: 'issuePullRequest', id: pr.id });

    await service.onPrClosed(101, { merged: false });

    // Assertion: removeArtifactsDir was NOT called during onPrClosed.
    expect(artifactsFakes.removeArtifactsDir).not.toHaveBeenCalled();
  }, 30000);
});
