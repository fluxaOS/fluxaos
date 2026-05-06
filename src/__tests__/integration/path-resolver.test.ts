/**
 * Integration tests: src/adapters/git/path-resolver.ts against real filesystem.
 *
 * Touches real tmpdirs for repoPath resolution. No DB.
 * Config overrides are passed as parameters — no process.env manipulation needed.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getDefaultHomeWorkspaceRoot,
  getWorkspaceRoot,
  getWorktreeBase,
  getWorktreePath,
  resolveRepoIdentity,
} from '@/adapters/git/path-resolver';

describe('resolveRepoIdentity', () => {
  it('accepts explicit override in owner/repo format', () => {
    expect(resolveRepoIdentity({ override: 'acme/widgets' })).toEqual({
      owner: 'acme',
      repo: 'widgets',
    });
  });

  it('rejects malformed override', () => {
    expect(() => resolveRepoIdentity({ override: 'nope' })).toThrow();
    expect(() => resolveRepoIdentity({ override: 'a/b/c' })).toThrow();
  });

  it('parses GitHub HTTPS repoUrl', () => {
    expect(
      resolveRepoIdentity({ repoUrl: 'https://github.com/acme/widgets' })
    ).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('parses GitHub HTTPS repoUrl with .git suffix', () => {
    expect(
      resolveRepoIdentity({ repoUrl: 'https://github.com/acme/widgets.git' })
    ).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('parses GitHub SSH repoUrl', () => {
    expect(
      resolveRepoIdentity({ repoUrl: 'git@github.com:acme/widgets.git' })
    ).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('parses GitLab repoUrl', () => {
    expect(
      resolveRepoIdentity({ repoUrl: 'https://gitlab.com/acme/widgets.git' })
    ).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('falls back to path basename when repoUrl is absent', () => {
    expect(resolveRepoIdentity({ repoPath: '/mnt/dev/acme/widgets' })).toEqual({
      owner: 'acme',
      repo: 'widgets',
    });
  });

  it('prefers override over repoUrl', () => {
    expect(
      resolveRepoIdentity({
        override: 'a/b',
        repoUrl: 'https://github.com/x/y',
        repoPath: '/tmp/c/d',
      })
    ).toEqual({ owner: 'a', repo: 'b' });
  });

  it('prefers repoUrl over repoPath', () => {
    expect(
      resolveRepoIdentity({
        repoUrl: 'https://github.com/x/y',
        repoPath: '/tmp/c/d',
      })
    ).toEqual({ owner: 'x', repo: 'y' });
  });

  it('throws when no input can resolve', () => {
    expect(() => resolveRepoIdentity({})).toThrow();
  });
});

describe('getWorkspaceRoot', () => {
  it('returns null without an override', () => {
    expect(getWorkspaceRoot(undefined)).toBeNull();
    expect(getWorkspaceRoot()).toBeNull();
  });

  it('returns the override when absolute', () => {
    expect(getWorkspaceRoot('/srv/fluxaos/workspaces')).toBe(
      '/srv/fluxaos/workspaces'
    );
  });

  it('throws on relative override', () => {
    expect(() => getWorkspaceRoot('relative/path')).toThrow();
  });
});

describe('getWorktreeBase + getWorktreePath against real tmpdirs', () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await mkdtemp(join(tmpdir(), 'fluxaos-path-resolver-'));
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  it('puts worktrees inside the repo by default', () => {
    const base = getWorktreeBase({
      repoPath,
      repoIdentity: { owner: 'acme', repo: 'widgets' },
    });
    expect(base).toBe(join(repoPath, '.fluxaos-worktrees'));
  });

  it('uses override root when workspaceRoot is set', () => {
    const base = getWorktreeBase({
      repoPath,
      repoIdentity: { owner: 'acme', repo: 'widgets' },
      workspaceRoot: '/srv/flux',
    });
    expect(base).toBe('/srv/flux/acme/widgets/worktrees');
  });

  it('composes worktree path with slash-safe branch name', () => {
    const path = getWorktreePath({
      repoPath,
      repoIdentity: { owner: 'acme', repo: 'widgets' },
      branchName: 'fluxaos/issue-42-abc123de',
    });
    expect(path).toBe(
      join(repoPath, '.fluxaos-worktrees', 'fluxaos__issue-42-abc123de')
    );
  });

  it('handles branch names without slashes', () => {
    const path = getWorktreePath({
      repoPath,
      repoIdentity: { owner: 'acme', repo: 'widgets' },
      branchName: 'main',
    });
    expect(path).toBe(join(repoPath, '.fluxaos-worktrees', 'main'));
  });
});

describe('getDefaultHomeWorkspaceRoot', () => {
  it('composes ~/.fluxaos/workspaces', () => {
    const root = getDefaultHomeWorkspaceRoot();
    expect(root).toMatch(/\/\.fluxaos\/workspaces$/);
  });
});
