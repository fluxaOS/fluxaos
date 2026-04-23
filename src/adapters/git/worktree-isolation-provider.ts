/**
 * Worktree-based implementation of the IsolationProvider port.
 *
 * Stitches T3 (path-resolver), T4 (git helpers), and T5 (worktree-copy)
 * together with Drizzle-backed DB state. Upsert/repair-aware acquire
 * semantics: re-running the same (projectId, runId) returns the existing
 * environment if its worktree is still on disk, or reconstructs the
 * worktree if the row exists but the directory is gone.
 *
 * Also responsible for adding `.fluxaos-worktrees/` to the target repo's
 * .gitignore on first acquire (in-project layout only), so worktrees
 * don't pollute the user's `git status`.
 *
 * Shape borrowed from Archon's packages/isolation/src/providers/worktree.ts
 * (MIT, shape-only).
 */

import { and, desc, eq } from 'drizzle-orm';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '@/core/db/connection';
import { isolationEnvironment } from '@/core/db/schema';
import type {
  AcquireEnvironmentParams,
  IsolationEnvironment,
  IsolationProvider,
  ReleaseOptions,
} from '@/core/ports/isolation';
import {
  getWorkspaceRoot,
  getWorktreePath,
  type RepoIdentity,
} from './path-resolver';
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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Ensure `.fluxaos-worktrees/` is in the target repo's .gitignore.
 * Only applies to the default (in-project) layout; a no-op when an
 * external FLUXAOS_WORKSPACE_ROOT is configured.
 */
async function ensureGitignoreEntry(repoPath: string): Promise<void> {
  if (getWorkspaceRoot()) return; // external root — no .gitignore change needed

  const gitignorePath = join(repoPath, '.gitignore');
  const entry = '.fluxaos-worktrees/';
  let content = '';
  try {
    content = await readFile(gitignorePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const lines = content.split('\n');
  const alreadyPresent = lines.some(
    (l) =>
      l.trim() === entry ||
      l.trim() === '.fluxaos-worktrees' ||
      l.trim() === '/.fluxaos-worktrees' ||
      l.trim() === '/.fluxaos-worktrees/'
  );
  if (alreadyPresent) return;

  const needsLeadingNewline = content.length > 0 && !content.endsWith('\n');
  const suffix =
    (needsLeadingNewline ? '\n' : '') +
    `\n# fluxaOS per-run worktrees (managed by R-RUNTIME)\n${entry}\n`;
  await writeFile(gitignorePath, content + suffix, 'utf-8');
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
      return rowToDomain(existing);
    }

    if (existing && !(await worktreeExists(existing.workingPath))) {
      // Row exists but worktree gone. Repair: recreate worktree, update row.
      await ensureGitignoreEntry(repoPath);
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
      const [updated] = await db
        .update(isolationEnvironment)
        .set({ updatedAt: new Date() })
        .where(eq(isolationEnvironment.id, existing.id))
        .returning();
      return rowToDomain(updated);
    }

    // 2. No active row. Mint a new worktree + row atomically.
    await ensureGitignoreEntry(repoPath);
    await createWorktree(repoPath, worktreePath, branchName, baseBranch);

    let copyReport;
    if (copyFiles.length > 0) {
      copyReport = await copyConfiguredFiles(repoPath, worktreePath, copyFiles);
    }

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
        })
        .returning();
      return rowToDomain(row);
    } catch (err) {
      // DB insert failed — clean up the worktree so next acquire doesn't
      // find a stray directory.
      await removeWorktree(repoPath, worktreePath, { force: true }).catch(
        () => undefined
      );
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
