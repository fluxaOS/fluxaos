/**
 * Integration tests: WorktreeIsolationProvider against real Supabase + real git.
 *
 * Creates disposable org/user/project/pipeline/pipeline_run rows in the DB,
 * a disposable git repo in a tmpdir, and exercises acquire/release/repair.
 * Teardown removes everything.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import * as schema from '@/core/db/schema';
import { createWorktreeIsolationProvider, UncommittedChangesError } from '@/adapters/git/worktree-isolation-provider';
import type { Database } from '@/core/db/connection';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();
const execFileAsync = promisify(execFile);

const RUN = Date.now();
const cleanup: { table: string; id: string }[] = [];

afterAll(async () => {
  for (const { table, id } of cleanup.reverse()) {
    const t = (schema as Record<string, unknown>)[table];
    if (t)
      await db
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .delete(t as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .where(eq((t as any).id, id))
        .catch(() => undefined);
  }
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
  cleanup.push({ table: 'organization', id: org.id });

  const [user] = await db
    .insert(schema.user)
    .values({
      orgId: org.id,
      email: `iso-${RUN}@test.local`,
      name: 'Iso',
      slug: `iso-${RUN}`,
    })
    .returning();
  cleanup.push({ table: 'user', id: user.id });

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
  cleanup.push({ table: 'project', id: project.id });
  projectId = project.id;

  const [pipeline] = await db
    .insert(schema.pipeline)
    .values({ projectId: project.id, name: 'iso-pipe' })
    .returning();
  cleanup.push({ table: 'pipeline', id: pipeline.id });

  const [run] = await db
    .insert(schema.pipelineRun)
    .values({ pipelineId: pipeline.id, status: 'pending' })
    .returning();
  cleanup.push({ table: 'pipelineRun', id: run.id });
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
    cleanup.push({ table: 'isolationEnvironment', id: env.id });

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
      .values({ pipelineId: (await db.select().from(schema.pipeline).where(eq(schema.pipeline.projectId, projectId)))[0].id, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run2.id });

    const first = await isolationProvider.acquire({
      projectId,
      runId: run2.id,
      repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'isolation-test-fixture' },
      branchName: `fluxaos/iso-${RUN}-b`,
    });
    cleanup.push({ table: 'isolationEnvironment', id: first.id });

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
      .values({ pipelineId: (await db.select().from(schema.pipeline).where(eq(schema.pipeline.projectId, projectId)))[0].id, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run3.id });

    const env = await isolationProvider.acquire({
      projectId,
      runId: run3.id,
      repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'isolation-test-fixture' },
      branchName: `fluxaos/iso-${RUN}-c`,
    });
    cleanup.push({ table: 'isolationEnvironment', id: env.id });

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
      .values({ pipelineId: (await db.select().from(schema.pipeline).where(eq(schema.pipeline.projectId, projectId)))[0].id, status: 'pending' })
      .returning();
    cleanup.push({ table: 'pipelineRun', id: run4.id });

    const env = await isolationProvider.acquire({
      projectId,
      runId: run4.id,
      repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'isolation-test-fixture' },
      branchName: `fluxaos/iso-${RUN}-d`,
    });
    cleanup.push({ table: 'isolationEnvironment', id: env.id });

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
});

afterAll(async () => {
  if (repoPath) await rm(repoPath, { recursive: true, force: true });
});
