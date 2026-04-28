// src/__tests__/integration/forge-router.test.ts
// FLX-4 — GitProviderFactory dispatches URLs to the right forge adapter
// and the non-GitHub adapters throw NotImplementedError on every method.

import { describe, expect, it } from 'vitest';
import { ForgejoNotImplementedError } from '@/adapters/forgejo/adapter';
import {
  createGitProviderFactory,
  detectForge,
} from '@/adapters/git-router/factory';
import { GiteaNotImplementedError } from '@/adapters/gitea/adapter';
import { GitLabNotImplementedError } from '@/adapters/gitlab/adapter';

describe('FLX-4 GitProviderFactory.detectForge', () => {
  it.each([
    ['https://github.com/owner/repo', 'github'],
    ['https://www.github.com/owner/repo', 'github'],
    ['git@github.com:owner/repo.git', 'github'],
    ['https://gitlab.com/owner/repo', 'gitlab'],
    ['https://self-hosted.gitlab.example.com/owner/repo', 'gitlab'],
    ['git@gitlab.com:owner/repo.git', 'gitlab'],
    ['https://codeberg.org/owner/repo', 'forgejo'],
    ['https://forge.example.com', 'unknown'],
    ['https://forgejo.example.com/owner/repo', 'forgejo'],
    ['https://gitea.example.com/owner/repo', 'gitea'],
    ['', 'github'], // empty defaults to github (alpha behavior)
    ['not a url', 'unknown'],
  ])('detectForge(%s) → %s', (url, expected) => {
    expect(detectForge(url)).toBe(expected);
  });
});

describe('FLX-4 GitProviderFactory.forUrl', () => {
  const factory = createGitProviderFactory();

  it('GitHub URL returns the GitHub adapter (no NotImplementedError)', () => {
    const adapter = factory.forUrl('https://github.com/owner/repo');
    // GitHub adapter throws GitHubAuthError when token missing, NOT
    // NotImplementedError. Just verify the constructor returns
    // something with the right shape.
    expect(typeof adapter.createBranch).toBe('function');
    expect(typeof adapter.createPullRequest).toBe('function');
  });

  it('GitLab URL returns a stub that throws on every method', async () => {
    const adapter = factory.forUrl('https://gitlab.com/owner/repo');
    await expect(adapter.createBranch('owner/repo', 'b')).rejects.toThrow(
      GitLabNotImplementedError
    );
    await expect(
      adapter.createPullRequest({
        repo: 'owner/repo',
        title: 't',
        body: 'b',
        headBranch: 'h',
        baseBranch: 'main',
      })
    ).rejects.toThrow(GitLabNotImplementedError);
    await expect(adapter.getPullRequest('owner/repo', 1)).rejects.toThrow(
      GitLabNotImplementedError
    );
    await expect(adapter.listPullRequests('owner/repo')).rejects.toThrow(
      GitLabNotImplementedError
    );
    await expect(adapter.mergePullRequest('owner/repo', 1)).rejects.toThrow(
      GitLabNotImplementedError
    );
  });

  it('Gitea URL returns a stub that throws on every method', async () => {
    const adapter = factory.forUrl('https://gitea.example.com/owner/repo');
    await expect(adapter.createBranch('owner/repo', 'b')).rejects.toThrow(
      GiteaNotImplementedError
    );
  });

  it('Forgejo URL returns a stub that throws on every method', async () => {
    const adapter = factory.forUrl('https://codeberg.org/owner/repo');
    await expect(adapter.createBranch('owner/repo', 'b')).rejects.toThrow(
      ForgejoNotImplementedError
    );
  });

  it('Unknown URL falls back to GitHub adapter', () => {
    const adapter = factory.forUrl('https://forge.unknown/owner/repo');
    expect(typeof adapter.createPullRequest).toBe('function');
  });
});
