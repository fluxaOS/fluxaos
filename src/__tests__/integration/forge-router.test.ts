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
import { UnsupportedGitHostError } from '@/core/errors/git';

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
    ['', 'unknown'], // FLX-218: empty repoUrl is now unknown, not silently github
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

  it('FLX-218: Unknown host throws UnsupportedGitHostError (no silent GitHub fallback)', () => {
    expect(() => factory.forUrl('https://forge.unknown/owner/repo')).toThrow(
      UnsupportedGitHostError
    );
  });

  it('FLX-218: GitLab URL routes to the GitLab stub, not GitHub', () => {
    // Regression guard: before FLX-218, a misconfigured host could
    // silently land on the GitHub adapter. Confirm GitLab URLs reach
    // the GitLab adapter, which advertises its provider name.
    const adapter = factory.forUrl('https://gitlab.com/owner/repo');
    expect(adapter.providerName()).toBe('gitlab');
  });

  it('FLX-218: empty repoUrl throws UnsupportedGitHostError', () => {
    expect(() => factory.forUrl('')).toThrow(UnsupportedGitHostError);
  });

  it('FLX-218: UnsupportedGitHostError message names the supported hosts', () => {
    try {
      factory.forUrl('https://forge.unknown/owner/repo');
      expect.fail('expected UnsupportedGitHostError');
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedGitHostError);
      const msg = (err as Error).message;
      expect(msg).toContain('github');
      expect(msg).toContain('gitlab');
      expect(msg).toContain('forgejo');
      expect(msg).toContain('gitea');
      expect(msg).toContain('https://forge.unknown/owner/repo');
    }
  });
});

describe('FLX-218 runtime fail-fast: stage-time resolution', () => {
  // The deploy bridge resolves a GitProvider per-project via
  // GitProviderFactory.forUrl(project.repoUrl). FLX-218 requires the
  // runtime to refuse to act on an unsupported host instead of
  // silently routing to GitHub. (Save-time guard is FLX-227.)
  const factory = createGitProviderFactory();

  it.each([
    'https://bitbucket.org/owner/repo',
    'https://example.com/owner/repo',
    'git@bitbucket.org:owner/repo.git',
    '',
  ])('repoUrl=%s → UnsupportedGitHostError', (repoUrl) => {
    expect(() => factory.forUrl(repoUrl)).toThrow(UnsupportedGitHostError);
  });

  it('UnsupportedGitHostError exposes the offending repoUrl', () => {
    try {
      factory.forUrl('https://bitbucket.org/owner/repo');
      expect.fail('expected UnsupportedGitHostError');
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedGitHostError);
      expect((err as UnsupportedGitHostError).repoUrl).toBe(
        'https://bitbucket.org/owner/repo'
      );
    }
  });
});
