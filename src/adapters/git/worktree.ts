/**
 * Thin shell-outs to `git` for worktree lifecycle + inspection.
 *
 * Every helper uses execFile (not exec) to avoid shell parsing of paths
 * or branch names. All async. No state outside function scope.
 *
 * Shape borrowed from Archon's packages/git/src/worktree.ts (MIT, shape-only).
 */

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  commit: string;
  isDetached: boolean;
  isBare: boolean;
}

export interface CommitAllResult {
  commitSha?: string;
  noChanges?: true;
}

async function runGit(
  cwd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
}

export async function createWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string,
  baseBranch: string
): Promise<void> {
  await runGit(repoPath, [
    'worktree',
    'add',
    '-b',
    branchName,
    worktreePath,
    baseBranch,
  ]);
}

export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  options: { force?: boolean } = {}
): Promise<void> {
  const args = ['worktree', 'remove', worktreePath];
  if (options.force) args.push('--force');
  await runGit(repoPath, args);
}

export async function worktreeExists(worktreePath: string): Promise<boolean> {
  try {
    await access(worktreePath);
    return true;
  } catch {
    return false;
  }
}

export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const { stdout } = await runGit(repoPath, [
    'worktree',
    'list',
    '--porcelain',
  ]);
  const blocks = stdout.split(/\n{2,}/).filter(Boolean);
  const worktrees: WorktreeInfo[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    let path = '';
    let commit = '';
    let branch: string | null = null;
    let isDetached = false;
    let isBare = false;
    for (const line of lines) {
      if (line.startsWith('worktree ')) path = line.slice(9).trim();
      else if (line.startsWith('HEAD ')) commit = line.slice(5).trim();
      else if (line.startsWith('branch ')) {
        const ref = line.slice(7).trim();
        branch = ref.replace(/^refs\/heads\//, '');
      } else if (line === 'detached') isDetached = true;
      else if (line === 'bare') isBare = true;
    }
    if (path) worktrees.push({ path, branch, commit, isDetached, isBare });
  }
  return worktrees;
}

export async function getCanonicalRepoPath(path: string): Promise<string> {
  const { stdout } = await runGit(path, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  const gitCommonDir = stdout.trim();
  return gitCommonDir.replace(/\/\.git\/?$/, '').replace(/\/\.git$/, '');
}

export async function hasUncommittedChanges(
  worktreePath: string
): Promise<boolean> {
  const { stdout } = await runGit(worktreePath, ['status', '--porcelain']);
  return stdout.trim().length > 0;
}

export async function isBranchMerged(
  repoPath: string,
  branchName: string,
  baseBranch: string
): Promise<boolean> {
  try {
    const { stdout } = await runGit(repoPath, [
      'branch',
      '--merged',
      baseBranch,
    ]);
    // `git branch` prefixes lines with:
    //   '* ' = currently checked out in this working tree
    //   '+ ' = checked out in another linked worktree
    //   '  ' = ordinary branch
    const lines = stdout
      .split('\n')
      .map((l) => l.replace(/^[*+]?\s+/, '').trim())
      .filter(Boolean);
    return lines.includes(branchName);
  } catch {
    return false;
  }
}

export async function getLastCommitDate(
  worktreePath: string
): Promise<Date | null> {
  try {
    const { stdout } = await runGit(worktreePath, [
      'log',
      '-1',
      '--format=%cI',
    ]);
    const iso = stdout.trim();
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * Current HEAD SHA in the given worktree.
 */
export async function getHeadSha(worktreePath: string): Promise<string> {
  const { stdout } = await runGit(worktreePath, ['rev-parse', 'HEAD']);
  return stdout.trim();
}

/**
 * Count of commits the worktree's branch is ahead of `baseRef` by.
 *
 * Used by deploy bridge (FLX-92): after stage-runner auto-commits, the
 * deploy bridge's `commitAll` is a no-op, but the branch still has commits
 * to push. The deploy bridge should fall through to push + PR creation as
 * long as `branchAheadCount > 0`, regardless of whether its own commitAll
 * added anything new.
 *
 * `baseRef` is typically `main` or `origin/main`.
 */
export async function branchAheadCount(
  worktreePath: string,
  baseRef: string
): Promise<number> {
  const { stdout } = await runGit(worktreePath, [
    'rev-list',
    '--count',
    `${baseRef}..HEAD`,
  ]);
  return Number.parseInt(stdout.trim(), 10) || 0;
}

export async function commitAll(
  worktreePath: string,
  message: string
): Promise<CommitAllResult> {
  await runGit(worktreePath, ['add', '-A']);
  const status = await runGit(worktreePath, ['status', '--porcelain']);
  if (status.stdout.trim().length === 0) {
    return { noChanges: true };
  }
  await runGit(worktreePath, ['commit', '-m', message]);
  const { stdout: shaOut } = await runGit(worktreePath, ['rev-parse', 'HEAD']);
  return { commitSha: shaOut.trim() };
}

export async function push(
  worktreePath: string,
  branchName: string,
  options: { setUpstream?: boolean } = {}
): Promise<void> {
  const args = ['push'];
  if (options.setUpstream) args.push('--set-upstream');
  args.push('origin', branchName);
  await runGit(worktreePath, args);
}
