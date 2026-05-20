/**
 * Integration tests for FLX-223 — `runtime.artifacts_root` config_entry as
 * the DB-backed source of truth for per-run artifact directories.
 *
 * Mirrors the FLX-222 (`runtime.workspace_root`) test shape exactly. The
 * worktree isolation provider reads the `runtime.artifacts_root` row on
 * every acquire (no module-level cache). This test exercises four branches:
 *
 *   a) Row exists with jsonb null → acquire succeeds, in-project layout
 *      (`<repo>/.fluxaos-artifacts/<runId>/`).
 *   b) Row exists with absolute path string → acquire succeeds, override
 *      layout (`<override>/<runId>/`).
 *   c) Row missing → acquire throws MissingGlobalConfigError.
 *   d) Row value re-read on every acquire — no module-level cache.
 *
 * Real Supabase + real git tmpdir. The unique index on
 * `(scope, project_id, key)` treats NULL `project_id` as distinct, so we
 * manage the row directly with `WHERE` + `INSERT/UPDATE/DELETE` instead of
 * `onConflictDoNothing()`.
 */
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorktreeIsolationProvider } from '@/adapters/git/worktree-isolation-provider';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { GLOBAL_CONFIG_KEY } from '@/core/constants';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import { MissingGlobalConfigError } from '@/core/services/runtime-config';
import { deleteOrgFixture } from './cleanup-fixtures';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();
const execFileAsync = promisify(execFile);

const RUN = `flx-223-${Date.now()}`;
let _orgId: string;
let repoPath: string;
let projectId: string;
let pipelineId: string;
let externalArtifactsRoot: string;

async function gitInTmp(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

/** Inspect the current `runtime.artifacts_root` row (returns null if missing). */
async function readArtifactsRootRow(): Promise<{ value: unknown } | null> {
  const [row] = await db
    .select({ value: schema.configEntry.value })
    .from(schema.configEntry)
    .where(
      and(
        eq(schema.configEntry.scope, 'global'),
        isNull(schema.configEntry.projectId),
        eq(schema.configEntry.key, GLOBAL_CONFIG_KEY.runtimeArtifactsRoot)
      )
    );
  return row ?? null;
}

/**
 * Set the artifacts-root value to either jsonb null or a JSON-encoded string.
 * Inserts the row if it doesn't already exist.
 */
async function setArtifactsRootValue(value: string | null): Promise<void> {
  const existing = await readArtifactsRootRow();
  const literal = sql`${JSON.stringify(value)}::jsonb`;
  if (existing) {
    await db
      .update(schema.configEntry)
      .set({ value: literal, updatedAt: new Date() })
      .where(
        and(
          eq(schema.configEntry.scope, 'global'),
          isNull(schema.configEntry.projectId),
          eq(schema.configEntry.key, GLOBAL_CONFIG_KEY.runtimeArtifactsRoot)
        )
      );
  } else {
    await db.insert(schema.configEntry).values({
      scope: 'global',
      projectId: null,
      key: GLOBAL_CONFIG_KEY.runtimeArtifactsRoot,
      value: literal,
    });
  }
}

/** Hard-delete the artifacts-root row. */
async function deleteArtifactsRootRow(): Promise<void> {
  await db
    .delete(schema.configEntry)
    .where(
      and(
        eq(schema.configEntry.scope, 'global'),
        isNull(schema.configEntry.projectId),
        eq(schema.configEntry.key, GLOBAL_CONFIG_KEY.runtimeArtifactsRoot)
      )
    );
}

beforeAll(async () => {
  repoPath = await mkdtemp(join(tmpdir(), `${RUN}-repo-`));
  externalArtifactsRoot = await mkdtemp(join(tmpdir(), `${RUN}-ext-`));
  // Ensure the override path nests under a guaranteed-empty subdir so the
  // artifacts provider has a writable owner/repo tree.
  await mkdir(join(externalArtifactsRoot, 'sub'), { recursive: true });

  await gitInTmp(repoPath, ['init', '-b', 'main']);
  await gitInTmp(repoPath, ['config', 'user.email', 'flx223@fluxaos.local']);
  await gitInTmp(repoPath, ['config', 'user.name', 'FLX223']);
  await gitInTmp(repoPath, ['commit', '--allow-empty', '-m', 'initial']);

  const [org] = await db
    .insert(schema.organization)
    .values({ name: `${RUN}-org`, slug: `${RUN}-org` })
    .returning();
  _orgId = org.id;

  const [user] = await db
    .insert(schema.user)
    .values({
      orgId: org.id,
      email: `${RUN}@test.local`,
      name: 'FLX223',
      slug: `${RUN}-user`,
    })
    .returning();

  const [proj] = await db
    .insert(schema.project)
    .values({
      orgId: org.id,
      teamId: (
        await db
          .insert(schema.team)
          .values({ orgId: org.id, name: `${RUN}-team` })
          .returning()
      )[0].id,
      name: `${RUN}-proj`,
      slug: `${RUN}-proj`,
      repoUrl: 'https://github.com/fluxaos/flx-223-fixture',
    })
    .returning();
  await db
    .insert(schema.projectMember)
    .values({ userId: user.id, projectId: proj.id });
  projectId = proj.id;

  const [pipe] = await db
    .insert(schema.pipeline)
    .values({ projectId: proj.id, name: 'flx-223-pipe' })
    .returning();
  pipelineId = pipe.id;
}, 30_000);

afterAll(async () => {
  if (_orgId) await deleteOrgFixture(db, _orgId);
  if (repoPath) await rm(repoPath, { recursive: true, force: true });
  if (externalArtifactsRoot)
    await rm(externalArtifactsRoot, { recursive: true, force: true });

  // Restore the seed default (jsonb null) so the rest of the suite (and
  // operator's local DB) is unaffected by our mutations.
  await setArtifactsRootValue(null);
  await provider.close();
});

describe('FLX-223 — runtime.artifacts_root config_entry is the artifacts root source of truth', () => {
  it('jsonb null row → acquire uses the in-project .fluxaos-artifacts/ layout', async () => {
    await setArtifactsRootValue(null);
    const isolationProvider = createWorktreeIsolationProvider({ db });

    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId, status: 'pending' })
      .returning();

    const env = await isolationProvider.acquire({
      projectId,
      runId: run.id,
      repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'flx-223-fixture' },
      branchName: `${run.id.slice(0, 8)}-nullbranch`,
      baseBranch: 'main',
    });

    expect(env.status).toBe('active');
    expect(env.artifactsPath).not.toBeNull();
    expect(env.artifactsPath ?? '').toContain('.fluxaos-artifacts');
    expect((env.artifactsPath ?? '').startsWith(repoPath)).toBe(true);
  }, 60_000);

  it('string-valued row → acquire honors the absolute path override', async () => {
    await setArtifactsRootValue(externalArtifactsRoot);
    const isolationProvider = createWorktreeIsolationProvider({ db });

    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId, status: 'pending' })
      .returning();

    const env = await isolationProvider.acquire({
      projectId,
      runId: run.id,
      repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'flx-223-fixture' },
      branchName: `${run.id.slice(0, 8)}-overridebranch`,
      baseBranch: 'main',
    });

    expect(env.status).toBe('active');
    expect(env.artifactsPath).not.toBeNull();
    expect((env.artifactsPath ?? '').startsWith(externalArtifactsRoot)).toBe(
      true
    );
    // The artifacts path is `<override>/<runId>/` — no `.fluxaos-artifacts`
    // segment when an explicit artifactsRoot is set.
    expect(env.artifactsPath ?? '').toContain(run.id);
  }, 60_000);

  it('missing row → acquire throws MissingGlobalConfigError (no fallback)', async () => {
    await deleteArtifactsRootRow();
    const isolationProvider = createWorktreeIsolationProvider({ db });

    const [run] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId, status: 'pending' })
      .returning();

    await expect(
      isolationProvider.acquire({
        projectId,
        runId: run.id,
        repoPath,
        repoIdentity: { owner: 'fluxaos', repo: 'flx-223-fixture' },
        branchName: `${run.id.slice(0, 8)}-nullrowbranch`,
        baseBranch: 'main',
      })
    ).rejects.toBeInstanceOf(MissingGlobalConfigError);
  }, 30_000);

  it('row value is re-read on every acquire — no module-level cache', async () => {
    // 1) jsonb null → in-project layout.
    await setArtifactsRootValue(null);
    const isolationProvider = createWorktreeIsolationProvider({ db });

    const [run1] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId, status: 'pending' })
      .returning();
    const env1 = await isolationProvider.acquire({
      projectId,
      runId: run1.id,
      repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'flx-223-fixture' },
      branchName: `${run1.id.slice(0, 8)}-cache-a`,
      baseBranch: 'main',
    });
    expect((env1.artifactsPath ?? '').startsWith(repoPath)).toBe(true);

    // 2) Mutate row to absolute-path override — same provider instance.
    await setArtifactsRootValue(externalArtifactsRoot);

    const [run2] = await db
      .insert(schema.pipelineRun)
      .values({ pipelineId, status: 'pending' })
      .returning();
    const env2 = await isolationProvider.acquire({
      projectId,
      runId: run2.id,
      repoPath,
      repoIdentity: { owner: 'fluxaos', repo: 'flx-223-fixture' },
      branchName: `${run2.id.slice(0, 8)}-cache-b`,
      baseBranch: 'main',
    });
    expect((env2.artifactsPath ?? '').startsWith(externalArtifactsRoot)).toBe(
      true
    );
  }, 90_000);
});
