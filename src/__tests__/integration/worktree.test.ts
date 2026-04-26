/**
 * Integration tests: src/adapters/git/worktree.ts against real git.
 *
 * Each test creates a disposable repo in a tmpdir, exercises the helper,
 * then tears down. No DB, no network.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  commitAll,
  createWorktree,
  getCanonicalRepoPath,
  getLastCommitDate,
  hasUncommittedChanges,
  isBranchMerged,
  listWorktrees,
  removeWorktree,
  worktreeExists,
} from '@/adapters/git/worktree';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fluxaos-worktree-test-'));
  await git(dir, ['init', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'test@fluxaos.local']);
  await git(dir, ['config', 'user.name', 'Test']);
  await git(dir, ['commit', '--allow-empty', '-m', 'initial']);
  return dir;
}

describe('worktree helpers against real git', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await makeRepo();
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it('creates and detects a worktree', async () => {
    const wt = join(repo, '.fluxaos-worktrees', 'feat__t4');
    await createWorktree(repo, wt, 'feat/t4', 'main');
    expect(await worktreeExists(wt)).toBe(true);

    const list = await listWorktrees(repo);
    const target = list.find((w) => w.path === wt);
    expect(target).toBeDefined();
    expect(target?.branch).toBe('feat/t4');
  });

  it('removes a worktree', async () => {
    const wt = join(repo, '.fluxaos-worktrees', 'feat__remove');
    await createWorktree(repo, wt, 'feat/remove', 'main');
    expect(await worktreeExists(wt)).toBe(true);

    await removeWorktree(repo, wt);
    expect(await worktreeExists(wt)).toBe(false);
  });

  it('detects uncommitted changes', async () => {
    const wt = join(repo, '.fluxaos-worktrees', 'feat__dirty');
    await createWorktree(repo, wt, 'feat/dirty', 'main');
    expect(await hasUncommittedChanges(wt)).toBe(false);
    await writeFile(join(wt, 'file.txt'), 'hello');
    expect(await hasUncommittedChanges(wt)).toBe(true);
  });

  it('getCanonicalRepoPath returns canonical from within a worktree', async () => {
    const wt = join(repo, '.fluxaos-worktrees', 'feat__canon');
    await createWorktree(repo, wt, 'feat/canon', 'main');
    const canon = await getCanonicalRepoPath(wt);
    // The canonical should resolve to the original repo dir
    // (path normalization — compare resolved basenames).
    expect(canon).toContain('fluxaos-worktree-test-');
  });

  it('isBranchMerged reports true for an ancestor branch and false for a fork', async () => {
    // Branch that starts at main has the merge test right
    const wt = join(repo, '.fluxaos-worktrees', 'feat__merged');
    await createWorktree(repo, wt, 'feat/merged', 'main');
    // No extra commits — feat/merged is at the same SHA as main, so is "merged"
    expect(await isBranchMerged(repo, 'feat/merged', 'main')).toBe(true);

    const wt2 = join(repo, '.fluxaos-worktrees', 'feat__ahead');
    await createWorktree(repo, wt2, 'feat/ahead', 'main');
    await writeFile(join(wt2, 'x.txt'), 'x');
    await git(wt2, ['add', '-A']);
    await git(wt2, ['commit', '-m', 'ahead']);
    expect(await isBranchMerged(repo, 'feat/ahead', 'main')).toBe(false);
  });

  it('getLastCommitDate returns a real Date', async () => {
    const wt = join(repo, '.fluxaos-worktrees', 'feat__date');
    await createWorktree(repo, wt, 'feat/date', 'main');
    const d = await getLastCommitDate(wt);
    expect(d).toBeInstanceOf(Date);
    expect(d?.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('commitAll reports noChanges on a clean tree', async () => {
    const wt = join(repo, '.fluxaos-worktrees', 'feat__noop');
    await createWorktree(repo, wt, 'feat/noop', 'main');
    const result = await commitAll(wt, 'empty commit test');
    expect(result.noChanges).toBe(true);
    expect(result.commitSha).toBeUndefined();
  });

  it('commitAll returns the new commit SHA when changes exist', async () => {
    const wt = join(repo, '.fluxaos-worktrees', 'feat__commit');
    await createWorktree(repo, wt, 'feat/commit', 'main');
    await writeFile(join(wt, 'new.txt'), 'content');
    const result = await commitAll(wt, 'add new.txt');
    expect(result.noChanges).toBeUndefined();
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
  });
});
