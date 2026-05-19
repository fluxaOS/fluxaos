/**
 * FLX-221: project.target_repo_path column replaces the prior env-backed
 * target repo path. Verifies the four pieces of the migration:
 *   (a) freshly-inserted project rows have target_repo_path = null
 *       (no default in the schema; column is nullable).
 *   (b) project.update via tRPC accepts and persists targetRepoPath.
 *   (c) acquireIsolationEnv throws MissingProjectTargetRepoPathError
 *       when target_repo_path is null on the project being run.
 *   (d) acquireIsolationEnv consumes target_repo_path from the project
 *       row when set, and threads it through to the isolation provider.
 *
 * Real Supabase, real isolation-provider, real git tmp repo. No mocks.
 */
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createGitOps } from '@/adapters/git/git-ops';
import { createWorktreeIsolationProvider } from '@/adapters/git/worktree-isolation-provider';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import {
  acquireIsolationEnv,
  MissingProjectTargetRepoPathError,
} from '@/core/orchestrator/stage-runner-env';
import { appRouter } from '@/server/root';
import { deleteOrgFixture } from './cleanup-fixtures';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();
const execFileAsync = promisify(execFile);

const RUN = `flx-221-${Date.now()}`;
const orgIds: string[] = [];
const tempDirs: string[] = [];

afterAll(async () => {
  for (const orgId of orgIds) {
    await deleteOrgFixture(db, orgId);
  }
  for (const dir of tempDirs.reverse()) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  await provider.close();
}, 60_000);

async function gitInTmp(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

async function makeRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await gitInTmp(dir, ['init', '-b', 'main']);
  await gitInTmp(dir, ['config', 'user.email', 'flx221@fluxaos.local']);
  await gitInTmp(dir, ['config', 'user.name', 'FLX-221']);
  await gitInTmp(dir, ['commit', '--allow-empty', '-m', 'initial']);
  tempDirs.push(dir);
  return dir;
}

async function createFixture(): Promise<{
  orgId: string;
  userId: string;
  projectId: string;
  pipelineId: string;
}> {
  const slug = `${RUN}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(schema.organization)
    .values({ name: slug, slug })
    .returning();
  orgIds.push(org.id);
  const [userRow] = await db
    .insert(schema.user)
    .values({
      orgId: org.id,
      email: `${slug}@test.local`,
      name: slug,
      slug,
    })
    .returning();
  const [projectRow] = await db
    .insert(schema.project)
    .values({
      orgId: org.id,
      userId: userRow.id,
      name: slug,
      slug,
      repoUrl: 'https://github.com/fluxaos/flx-221-fixture',
      defaultBranch: 'main',
    })
    .returning();
  const [pipe] = await db
    .insert(schema.pipeline)
    .values({ projectId: projectRow.id, name: slug })
    .returning();
  return {
    orgId: org.id,
    userId: userRow.id,
    projectId: projectRow.id,
    pipelineId: pipe.id,
  };
}

describe('FLX-221 — project.target_repo_path column', () => {
  it('freshly-inserted project rows have target_repo_path = null', async () => {
    const f = await createFixture();
    const [row] = await db
      .select({ targetRepoPath: schema.project.targetRepoPath })
      .from(schema.project)
      .where(eq(schema.project.id, f.projectId));
    expect(row.targetRepoPath).toBeNull();
  });

  it('project.update mutation persists targetRepoPath and reads it back', async () => {
    const f = await createFixture();
    const caller = appRouter.createCaller({
      db,
      viewer: {
        authUserId: null,
        fluxaUserId: null,
        role: 'admin',
        tier: 'enterprise',
      },
    });
    const repoPath = await makeRepo('flx-221-set-');

    await caller.project.update({
      id: f.projectId,
      targetRepoPath: repoPath,
    });

    const [after] = await db
      .select({ targetRepoPath: schema.project.targetRepoPath })
      .from(schema.project)
      .where(eq(schema.project.id, f.projectId));
    expect(after.targetRepoPath).toBe(repoPath);

    // Round-trip a clear (null) back through the mutation.
    await caller.project.update({
      id: f.projectId,
      targetRepoPath: null,
    });
    const [cleared] = await db
      .select({ targetRepoPath: schema.project.targetRepoPath })
      .from(schema.project)
      .where(eq(schema.project.id, f.projectId));
    expect(cleared.targetRepoPath).toBeNull();
  });

  it('acquireIsolationEnv throws MissingProjectTargetRepoPathError when target_repo_path is null', async () => {
    const f = await createFixture();
    const isolation = createWorktreeIsolationProvider({ db });
    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: f.pipelineId, issueId: null, status: 'pending' })
      .returning();

    await expect(
      acquireIsolationEnv({
        db,
        isolation,
        gitOps: createGitOps(),
        projectId: f.projectId,
        runId: run.id,
        pipelineId: f.pipelineId,
        issueId: null,
        issueNumber: null,
      })
    ).rejects.toBeInstanceOf(MissingProjectTargetRepoPathError);
  });

  it('acquireIsolationEnv uses target_repo_path from the project row when set', async () => {
    const f = await createFixture();
    const repoPath = await makeRepo('flx-221-acq-');
    await db
      .update(schema.project)
      .set({ targetRepoPath: repoPath })
      .where(eq(schema.project.id, f.projectId));

    const isolation = createWorktreeIsolationProvider({ db });
    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId: f.pipelineId, issueId: null, status: 'pending' })
      .returning();

    const result = await acquireIsolationEnv({
      db,
      isolation,
      gitOps: createGitOps(),
      projectId: f.projectId,
      runId: run.id,
      pipelineId: f.pipelineId,
      issueId: null,
      issueNumber: null,
    });

    expect(result.env).toBeTruthy();
    expect(result.projectRow.targetRepoPath).toBe(repoPath);
    // The isolation provider received a non-empty workingPath; that proves
    // acquire() ran against the project-row value (it throws upstream when
    // the column is null). Workspace root location is config-controlled
    // (FLX-222), so we don't assert the specific path here.
    expect(result.env.workingPath).toBeTruthy();

    await isolation.release(result.env.id);
  }, 30_000);
});
