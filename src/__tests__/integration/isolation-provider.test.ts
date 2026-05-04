/**
 * Integration tests: WorktreeIsolationProvider against real Supabase + real git.
 *
 * Creates disposable org/user/project/pipeline/pipeline_run rows in the DB,
 * a disposable git repo in a tmpdir, and exercises acquire/release/repair.
 * Teardown removes everything.
 */
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createWorktreeIsolationProvider,
  UncommittedChangesError,
} from '@/adapters/git/worktree-isolation-provider';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import { deleteOrgFixture } from './cleanup-fixtures';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();
const execFileAsync = promisify(execFile);

const RUN = Date.now();
let _orgId: string;

afterAll(async () => {
  if (_orgId) await deleteOrgFixture(db, _orgId);
  await provider.close();
});

async function gitInTmp(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

let repoPath: string;
let projectId: string;
let runId: string;
let isolationProvider: ReturnType<typeof createWorktreeIsolationProvider>;

beforeAll(async () => {
  repoPath = await mkdtemp(join(tmpdir(), `fluxaos-iso-provider-${RUN}-`));
  await gitInTmp(repoPath, ['init', '-b', 'main']);
  await gitInTmp(repoPath, ['config', 'user.email', 'iso@fluxaos.local']);
  await gitInTmp(repoPath, ['config', 'user.name', 'IsoTest']);
  await gitInTmp(repoPath, ['commit', '--allow-empty', '-m', 'initial']);

  const [org] = await db
    .insert(schema.organization)
    .values({ name: `iso-org-${RUN}`, slug: `iso-org-${RUN}` })
    .returning();
  _orgId = org.id;

  const [user] = await db
    .insert(schema.user)
    .values({
      orgId: org.id,
      email: `iso-${RUN}@test.local`,
      name: 'Iso',
      slug: `iso-${RUN}`,
    })
    .returning();

  const [project] = await db
    .insert(schema.project)
    .values({
      orgId: org.id,
      userId: user.id,
      name: `iso-proj-${RUN}`,
      slug: `iso-proj-${RUN}`,
      repoUrl: 'https://github.com/fluxaos/isolation-test-fixture',
    })
    .returning();
  projectId = project.id;

  const [pipeline] = await db
    .insert(schema.pipeline)
    .values({ projectId: project.id, name: 'iso-pipe' })
    .returning();

  const [run] = await db
    .insert(schema.pipelineRun)
    .values({ pipelineId: pipeline.id, status: 'pending' })
    .returning();
  runId = run.id;

  isolationProvider = createWorktreeIsolationProvider({ db });
}, 30000);

describe('WorktreeIsolationProvider', () => {
  it('acquire creates a worktree and DB row', async () => {
    const env = await isolationProvider.acquire({
      projectId,
      runId,
      repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'isolation-test-fixture' },
      branchName: `fluxaos/iso-${RUN}-a`,
    });

    expect(env.status).toBe('active');
    expect(env.branchName).toBe(`fluxaos/iso-${RUN}-a`);
    expect(env.workingPath).toContain('.fluxaos-worktrees');
    await access(env.workingPath); // throws if gone
  });

  it('acquire is re-entrant: second call returns same row + same worktree', async () => {
    // Use a fresh run for this test to avoid the active-row uniqueness
    // check against the first test's env.
    const [run2] = await db
      .insert(schema.pipelineRun)
      .values({
        pipelineId: (
          await db
            .select()
            .from(schema.pipeline)
            .where(eq(schema.pipeline.projectId, projectId))
        )[0].id,
        status: 'pending',
      })
      .returning();

    const first = await isolationProvider.acquire({
      projectId,
      runId: run2.id,
      repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'isolation-test-fixture' },
      branchName: `fluxaos/iso-${RUN}-b`,
    });

    const second = await isolationProvider.acquire({
      projectId,
      runId: run2.id,
      repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'isolation-test-fixture' },
      branchName: `fluxaos/iso-${RUN}-b`,
    });
    expect(second.id).toBe(first.id);
    expect(second.workingPath).toBe(first.workingPath);
  });

  it('release removes worktree and marks row inactive', async () => {
    const [run3] = await db
      .insert(schema.pipelineRun)
      .values({
        pipelineId: (
          await db
            .select()
            .from(schema.pipeline)
            .where(eq(schema.pipeline.projectId, projectId))
        )[0].id,
        status: 'pending',
      })
      .returning();

    const env = await isolationProvider.acquire({
      projectId,
      runId: run3.id,
      repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'isolation-test-fixture' },
      branchName: `fluxaos/iso-${RUN}-c`,
    });

    await isolationProvider.release(env.id);

    // Worktree gone
    await expect(access(env.workingPath)).rejects.toThrow();

    // Row marked inactive
    const after = await isolationProvider.findActiveByRun(projectId, run3.id);
    expect(after).toBeNull();
  });

  it('release refuses when uncommitted changes exist (unless force)', async () => {
    const [run4] = await db
      .insert(schema.pipelineRun)
      .values({
        pipelineId: (
          await db
            .select()
            .from(schema.pipeline)
            .where(eq(schema.pipeline.projectId, projectId))
        )[0].id,
        status: 'pending',
      })
      .returning();

    const env = await isolationProvider.acquire({
      projectId,
      runId: run4.id,
      repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'isolation-test-fixture' },
      branchName: `fluxaos/iso-${RUN}-d`,
    });

    // Dirty the worktree
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(env.workingPath, 'new.txt'), 'dirty');

    await expect(isolationProvider.release(env.id)).rejects.toBeInstanceOf(
      UncommittedChangesError
    );

    // With force it succeeds
    await isolationProvider.release(env.id, { force: true });
    await expect(access(env.workingPath)).rejects.toThrow();
  });

  it('ensures .fluxaos-worktrees/ is in .gitignore after first acquire', async () => {
    const { readFile } = await import('node:fs/promises');
    const gi = await readFile(join(repoPath, '.gitignore'), 'utf-8');
    expect(gi).toContain('.fluxaos-worktrees/');
  });

  it('fresh mint creates artifacts dir + records path on the env row', async () => {
    const [run] = await db
      .insert(schema.pipelineRun)
      .values({
        pipelineId: (
          await db
            .select()
            .from(schema.pipeline)
            .where(eq(schema.pipeline.projectId, projectId))
        )[0].id,
        status: 'pending',
      })
      .returning();

    const env = await isolationProvider.acquire({
      projectId,
      runId: run.id,
      repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'isolation-test-fixture' },
      branchName: `fluxaos/iso-${RUN}-art-fresh`,
    });

    // Domain object exposes the resolved absolute path.
    expect(env.artifactsPath).toBeTruthy();
    expect(env.artifactsPath?.startsWith('/')).toBe(true);
    expect(env.artifactsPath).toBe(
      join(repoPath, '.fluxaos-artifacts', run.id)
    );

    // Directory exists on disk (access throws if missing).
    await access(env.artifactsPath!);

    // DB row matches the returned path.
    const [row] = await db
      .select()
      .from(schema.isolationEnvironment)
      .where(eq(schema.isolationEnvironment.id, env.id));
    expect(row.artifactsPath).toBe(env.artifactsPath);
  });

  it('repair path preserves the artifacts_path recorded on the env row', async () => {
    const [run] = await db
      .insert(schema.pipelineRun)
      .values({
        pipelineId: (
          await db
            .select()
            .from(schema.pipeline)
            .where(eq(schema.pipeline.projectId, projectId))
        )[0].id,
        status: 'pending',
      })
      .returning();

    const first = await isolationProvider.acquire({
      projectId,
      runId: run.id,
      repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'isolation-test-fixture' },
      branchName: `fluxaos/iso-${RUN}-art-repair`,
    });

    const originalArtifactsPath = first.artifactsPath!;
    expect(originalArtifactsPath).toBeTruthy();

    // Simulate "worktree gone but row exists": remove the worktree dir
    // directly from disk without going through release(), then prune git's
    // admin records so the subsequent `git worktree add` doesn't collide
    // with a stale registration. (In production this happens organically
    // after disk wipes / FS corruption; the test models the recovered
    // state.)
    await rm(first.workingPath, { recursive: true, force: true });
    await gitInTmp(repoPath, ['worktree', 'prune']);

    // Second acquire hits the repair branch.
    const repaired = await isolationProvider.acquire({
      projectId,
      runId: run.id,
      repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'isolation-test-fixture' },
      branchName: `fluxaos/iso-${RUN}-art-repair`,
    });

    expect(repaired.id).toBe(first.id);
    expect(repaired.artifactsPath).toBe(originalArtifactsPath);
    // Artifacts dir still exists on disk (outlives worktree churn).
    await access(originalArtifactsPath);
  });

  it('ensures .fluxaos-artifacts/ is in .gitignore after first fresh mint', async () => {
    // Use a fresh repo to prove the entry appears on first acquire rather
    // than inheriting from an earlier test's side-effect.
    const freshRepo = await mkdtemp(
      join(tmpdir(), `fluxaos-iso-art-gi-${RUN}-`)
    );
    try {
      await gitInTmp(freshRepo, ['init', '-b', 'main']);
      await gitInTmp(freshRepo, ['config', 'user.email', 'iso@fluxaos.local']);
      await gitInTmp(freshRepo, ['config', 'user.name', 'IsoTest']);
      await gitInTmp(freshRepo, ['commit', '--allow-empty', '-m', 'initial']);

      const [run] = await db
        .insert(schema.pipelineRun)
        .values({
          pipelineId: (
            await db
              .select()
              .from(schema.pipeline)
              .where(eq(schema.pipeline.projectId, projectId))
          )[0].id,
          status: 'pending',
        })
        .returning();

      const env = await isolationProvider.acquire({
        projectId,
        runId: run.id,
        repoPath: freshRepo,
        repoIdentity: { owner: 'fluxaos', repo: 'isolation-test-fixture' },
        branchName: `fluxaos/iso-${RUN}-art-gi`,
      });

      const { readFile } = await import('node:fs/promises');
      const gi = await readFile(join(freshRepo, '.gitignore'), 'utf-8');
      expect(gi).toContain('.fluxaos-artifacts/');
    } finally {
      await rm(freshRepo, { recursive: true, force: true });
    }
  });
});

afterAll(async () => {
  if (repoPath) await rm(repoPath, { recursive: true, force: true });
});
