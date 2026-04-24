/**
 * Worktree-based implementation of the IsolationProvider port.
 *
 * Stitches T3 (path-resolver), T4 (git helpers), and T5 (worktree-copy)
 * together with Drizzle-backed DB state. Upsert/repair-aware acquire
 * semantics: re-running the same (projectId, runId) returns the existing
 * environment if its worktree is still on disk, or reconstructs the
 * worktree if the row exists but the directory is gone.
 *
 * Also responsible for adding `.fluxaos-worktrees/` (and, per R-ARTIFACTS,
 * `.fluxaos-artifacts/`) to the target repo's .gitignore on first acquire
 * (in-project layout only), so neither worktrees nor per-run artifacts
 * pollute the user's `git status`. The artifacts directory itself is also
 * minted on acquire — see `ensureArtifactsDir` calls below.
 *
 * Shape borrowed from Archon's packages/isolation/src/providers/worktree.ts
 * (MIT, shape-only).
 */

import { and, desc, eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { isolationEnvironment } from '@/core/db/schema';
import type {
  AcquireEnvironmentParams,
  IsolationEnvironment,
  IsolationProvider,
  ReleaseOptions,
} from '@/core/ports/isolation';
import { ensureArtifactsDir, removeArtifactsDir } from '@/adapters/fs';
import { getArtifactsPath } from './artifacts-path';
import { ensureGitignoreEntry } from './gitignore';
import { getWorkspaceRoot, getWorktreePath } from './path-resolver';
import { copyConfiguredFiles } from './worktree-copy';
import {
  createWorktree,
  hasUncommittedChanges,
  removeWorktree,
  worktreeExists,
} from './worktree';

export class UncommittedChangesError extends Error {
  constructor(envId: string, workingPath: string) {
    super(
      `Cannot release env ${envId}: uncommitted changes at ${workingPath}. ` +
        `Pass { force: true } to override.`
    );
    this.name = 'UncommittedChangesError';
  }
}

type IsolationRow = typeof isolationEnvironment.$inferSelect;

function rowToDomain(row: IsolationRow): IsolationEnvironment {
  return {
    id: row.id,
    projectId: row.projectId,
    runId: row.runId,
    provider: row.provider,
    workingPath: row.workingPath,
    branchName: row.branchName,
    status: row.status as 'active' | 'inactive',
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    artifactsPath: row.artifactsPath ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Ensure `.fluxaos-worktrees/` is in the target repo's .gitignore.
 * Only applies to the default (in-project) layout; a no-op when an
 * external FLUXAOS_WORKSPACE_ROOT is configured.
 *
 * Delegates to the shared `ensureGitignoreEntry` helper (src/adapters/git/
 * gitignore.ts). The env-var guard stays here in the call site because the
 * shared helper intentionally reads no env vars — different features
 * (worktrees, artifacts) have different "is it external?" predicates.
 */
async function ensureWorktreeGitignored(repoPath: string): Promise<void> {
  if (getWorkspaceRoot()) return; // external root — no .gitignore change needed
  await ensureGitignoreEntry(
    repoPath,
    '.fluxaos-worktrees/',
    'fluxaOS per-run worktrees (managed by R-RUNTIME)'
  );
}

/**
 * Ensure `.fluxaos-artifacts/` is in the target repo's .gitignore.
 * Sibling to `ensureWorktreeGitignored` — artifacts have a distinct
 * "is it external?" predicate: either FLUXAOS_WORKSPACE_ROOT or the
 * dedicated FLUXAOS_ARTIFACTS_ROOT override points outside the repo.
 * When either is set, the artifacts dir lives elsewhere and no
 * .gitignore entry is needed.
 */
async function ensureArtifactsGitignored(repoPath: string): Promise<void> {
  // No-op when either workspace root or artifacts root points outside the
  // repo — the directory isn't inside the target repo, so no .gitignore
  // entry is needed.
  if (getWorkspaceRoot()) return;
  if (process.env.FLUXAOS_ARTIFACTS_ROOT) return;
  await ensureGitignoreEntry(
    repoPath,
    '.fluxaos-artifacts/',
    'fluxaOS per-run artifacts (managed by R-ARTIFACTS)'
  );
}

export interface WorktreeIsolationProviderDeps {
  db: Database;
}

export function createWorktreeIsolationProvider(
  deps: WorktreeIsolationProviderDeps
): IsolationProvider {
  const { db } = deps;

  async function acquire(
    params: AcquireEnvironmentParams
  ): Promise<IsolationEnvironment> {
    const {
      projectId,
      runId,
      repoPath,
      repoIdentity,
      branchName,
      baseBranch = 'main',
      copyFiles = [],
      artifactsPath: artifactsPathParam,
    } = params;

    const worktreePath = getWorktreePath({
      repoPath,
      repoIdentity,
      branchName,
    });

    // 1. Check for an existing active environment for this run.
    const existingRows = await db
      .select()
      .from(isolationEnvironment)
      .where(
        and(
          eq(isolationEnvironment.projectId, projectId),
          eq(isolationEnvironment.runId, runId),
          eq(isolationEnvironment.status, 'active')
        )
      );
    const existing = existingRows[0];

    if (existing && (await worktreeExists(existing.workingPath))) {
      // Happy path: repeat acquire — reuse.
      if (existing.artifactsPath) {
        return rowToDomain(existing);
      }
      // Legacy pre-W1 env: row was acquired before R-ARTIFACTS added the
      // artifacts_path column. Backfill by resolving a fresh path, creating
      // the dir, and writing the column. Surfaced via console.warn so
      // operators see the backfill in logs.
      const backfillPath =
        artifactsPathParam ?? getArtifactsPath(repoPath, runId);
      await ensureArtifactsDir(backfillPath);
      console.warn('isolation.artifactsPath.backfilled', {
        envId: existing.id,
      });
      const [backfilled] = await db
        .update(isolationEnvironment)
        .set({ artifactsPath: backfillPath, updatedAt: new Date() })
        .where(eq(isolationEnvironment.id, existing.id))
        .returning();
      return rowToDomain(backfilled);
    }

    if (existing && !(await worktreeExists(existing.workingPath))) {
      // Row exists but worktree gone. Repair: recreate worktree, update row.
      await ensureWorktreeGitignored(repoPath);
      await createWorktree(repoPath, existing.workingPath, existing.branchName, baseBranch).catch(
        async (err) => {
          // If the branch already exists locally, fall back to re-adding the
          // worktree against the existing branch (no -b). Otherwise rethrow.
          const msg = (err as Error).message ?? '';
          if (!msg.includes('already exists')) throw err;
          const { execFile } = await import('node:child_process');
          const { promisify } = await import('node:util');
          const execFileAsync = promisify(execFile);
          await execFileAsync('git', [
            'worktree',
            'add',
            existing.workingPath,
            existing.branchName,
          ], { cwd: repoPath });
        }
      );
      // Re-copy configured files on repair so a freshly-recreated worktree
      // is usable immediately.
      if (copyFiles.length > 0) {
        await copyConfiguredFiles(repoPath, existing.workingPath, copyFiles);
      }
      // Preserve the existing artifacts_path if present; otherwise resolve
      // a fresh one (handles legacy rows acquired pre-W1). Ensure the dir
      // exists either way so stage-runner can write to it.
      const repairArtifactsPath =
        existing.artifactsPath ??
        artifactsPathParam ??
        getArtifactsPath(repoPath, runId);
      await ensureArtifactsDir(repairArtifactsPath);
      const [updated] = await db
        .update(isolationEnvironment)
        .set({
          artifactsPath: repairArtifactsPath,
          updatedAt: new Date(),
        })
        .where(eq(isolationEnvironment.id, existing.id))
        .returning();
      return rowToDomain(updated);
    }

    // 2. No active row. Mint a new worktree + row atomically.
    await ensureWorktreeGitignored(repoPath);
    await ensureArtifactsGitignored(repoPath);
    await createWorktree(repoPath, worktreePath, branchName, baseBranch);

    let copyReport;
    if (copyFiles.length > 0) {
      copyReport = await copyConfiguredFiles(repoPath, worktreePath, copyFiles);
    }

    const resolvedArtifactsPath =
      artifactsPathParam ?? getArtifactsPath(repoPath, runId);
    await ensureArtifactsDir(resolvedArtifactsPath);

    try {
      const [row] = await db
        .insert(isolationEnvironment)
        .values({
          projectId,
          runId,
          provider: 'worktree',
          workingPath: worktreePath,
          branchName,
          status: 'active',
          metadata: copyReport
            ? { copyReport: copyReport.entries }
            : {},
          artifactsPath: resolvedArtifactsPath,
        })
        .returning();
      return rowToDomain(row);
    } catch (err) {
      // DB insert failed — clean up the worktree AND the artifacts dir so
      // the next acquire doesn't find stray state on disk.
      await removeWorktree(repoPath, worktreePath, { force: true }).catch(
        () => undefined
      );
      await removeArtifactsDir(resolvedArtifactsPath).catch(() => undefined);
      throw err;
    }
  }

  async function release(
    envId: string,
    options: ReleaseOptions = {}
  ): Promise<void> {
    const [row] = await db
      .select()
      .from(isolationEnvironment)
      .where(eq(isolationEnvironment.id, envId));
    if (!row) return; // idempotent
    if (row.status === 'inactive') return;

    if (await worktreeExists(row.workingPath)) {
      if (!options.force && (await hasUncommittedChanges(row.workingPath))) {
        throw new UncommittedChangesError(envId, row.workingPath);
      }

      // Resolve the canonical repo for the git command. The worktree's
      // `.git` file points at its parent — we use the listWorktrees pattern
      // indirectly by running removeWorktree with the worktree path itself
      // as the cwd-target's repo. Since removeWorktree uses `cwd: repoPath`
      // we need the canonical path — derive from the worktree's internal
      // layout: `.fluxaos-worktrees/<X>` lives under the canonical repo.
      // For simplicity in alpha, run the removal from the worktree's parent
      // of parent (the repo root) when using the in-project layout.
      const canonicalRepoPath = await deriveCanonicalRepoPath(row.workingPath);
      await removeWorktree(canonicalRepoPath, row.workingPath, {
        force: options.force,
      }).catch(async (err) => {
        // If git refuses but the dir is gone anyway, swallow.
        if (!(await worktreeExists(row.workingPath))) return;
        throw err;
      });
    }

    await db
      .update(isolationEnvironment)
      .set({ status: 'inactive', updatedAt: new Date() })
      .where(eq(isolationEnvironment.id, envId));
  }

  async function findActiveByRun(
    projectId: string,
    runId: string
  ): Promise<IsolationEnvironment | null> {
    const [row] = await db
      .select()
      .from(isolationEnvironment)
      .where(
        and(
          eq(isolationEnvironment.projectId, projectId),
          eq(isolationEnvironment.runId, runId),
          eq(isolationEnvironment.status, 'active')
        )
      );
    return row ? rowToDomain(row) : null;
  }

  async function listActiveByProject(
    projectId: string
  ): Promise<IsolationEnvironment[]> {
    const rows = await db
      .select()
      .from(isolationEnvironment)
      .where(
        and(
          eq(isolationEnvironment.projectId, projectId),
          eq(isolationEnvironment.status, 'active')
        )
      )
      .orderBy(desc(isolationEnvironment.createdAt));
    return rows.map(rowToDomain);
  }

  return { acquire, release, findActiveByRun, listActiveByProject };
}

/**
 * Given a worktree path like `/repo/.fluxaos-worktrees/branch__name`, return
 * the canonical repo path. Uses getCanonicalRepoPath (git rev-parse).
 */
async function deriveCanonicalRepoPath(worktreePath: string): Promise<string> {
  const { getCanonicalRepoPath } = await import('./worktree');
  return getCanonicalRepoPath(worktreePath);
}
