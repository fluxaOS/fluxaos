/**
 * Integration tests: GitHubAdapter against the real GitHub API.
 *
 * Live tests (branch/PR creation) are skipped unless BOTH
 * FLUXAOS_GITHUB_TOKEN and FLUXAOS_TEST_TARGET_REPO (format: "owner/repo")
 * are set. The NotImplementedError and GitHubAuthError tests run
 * unconditionally — they don't touch the network.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Octokit } from '@octokit/rest';
import {
  createGitHubAdapter,
  GitHubAuthError,
  NotImplementedError,
  getAuthenticatedOctokit,
} from '@/adapters/github';

const TOKEN = process.env.FLUXAOS_GITHUB_TOKEN;
const TARGET_REPO = process.env.FLUXAOS_TEST_TARGET_REPO;
const HAS_CREDS = !!TOKEN && !!TARGET_REPO;

describe('GitHubAdapter — unit-ish (no network required)', () => {
  it('getAuthenticatedOctokit throws GitHubAuthError when FLUXAOS_GITHUB_TOKEN is unset', () => {
    const saved = process.env.FLUXAOS_GITHUB_TOKEN;
    delete process.env.FLUXAOS_GITHUB_TOKEN;
    try {
      expect(() => getAuthenticatedOctokit()).toThrowError(GitHubAuthError);
    } finally {
      if (saved !== undefined) process.env.FLUXAOS_GITHUB_TOKEN = saved;
    }
  });

  it('getPullRequest throws NotImplementedError', async () => {
    const adapter = createGitHubAdapter({ octokit: new Octokit() });
    await expect(adapter.getPullRequest('owner/repo', 1)).rejects.toBeInstanceOf(
      NotImplementedError
    );
  });

  it('listPullRequests throws NotImplementedError', async () => {
    const adapter = createGitHubAdapter({ octokit: new Octokit() });
    await expect(adapter.listPullRequests('owner/repo')).rejects.toBeInstanceOf(
      NotImplementedError
    );
  });

  it('mergePullRequest throws NotImplementedError', async () => {
    const adapter = createGitHubAdapter({ octokit: new Octokit() });
    await expect(
      adapter.mergePullRequest('owner/repo', 1)
    ).rejects.toBeInstanceOf(NotImplementedError);
  });
});

describe('GitHubAdapter — live against real GitHub API', () => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  if (!HAS_CREDS) {
    it.skip('requires FLUXAOS_GITHUB_TOKEN + FLUXAOS_TEST_TARGET_REPO', () => {
      /* skipped */
    });
    return;
  }

  const [owner, repoName] = TARGET_REPO!.split('/');
  const octokit = new Octokit({ auth: TOKEN });
  const adapter = createGitHubAdapter({ octokit });

  const RUN = Date.now();
  const createdBranches: string[] = [];
  const createdPRs: number[] = [];

  afterAll(async () => {
    // Close any PRs we opened, then delete any branches we created.
    for (const number of createdPRs) {
      await octokit.rest.pulls
        .update({ owner, repo: repoName, pull_number: number, state: 'closed' })
        .catch(() => undefined);
    }
    for (const branch of createdBranches) {
      await octokit.rest.git
        .deleteRef({ owner, repo: repoName, ref: `heads/${branch}` })
        .catch(() => undefined);
    }
  }, 30_000);

  let defaultBranch: string;
  let defaultBranchSha: string;

  beforeAll(async () => {
    const repoResp = await octokit.rest.repos.get({ owner, repo: repoName });
    defaultBranch = repoResp.data.default_branch;
    const refResp = await octokit.rest.git.getRef({
      owner,
      repo: repoName,
      ref: `heads/${defaultBranch}`,
    });
    defaultBranchSha = refResp.data.object.sha;
  }, 30_000);

  it('createBranch creates a branch off the default ref', async () => {
    const branch = `fluxaos/adapter-test-${RUN}-a`;
    await adapter.createBranch(TARGET_REPO!, branch);
    createdBranches.push(branch);

    const got = await octokit.rest.repos.getBranch({
      owner,
      repo: repoName,
      branch,
    });
    expect(got.data.name).toBe(branch);
  }, 30_000);

  it('createPullRequest opens a PR with a real diff', async () => {
    const branch = `fluxaos/adapter-test-${RUN}-b`;
    await adapter.createBranch(TARGET_REPO!, branch);
    createdBranches.push(branch);

    // Commit a unique file onto the branch so the PR has a diff.
    const filePath = `.fluxaos-test/${RUN}-b.txt`;
    const content = Buffer.from(
      `fluxaos adapter test ${RUN}\n`,
      'utf-8'
    ).toString('base64');
    await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo: repoName,
      path: filePath,
      message: `test(fluxaos): add ${filePath}`,
      content,
      branch,
    });

    const pr = await adapter.createPullRequest({
      repo: TARGET_REPO!,
      title: `fluxaos adapter test ${RUN}`,
      body: 'Opened by src/__tests__/integration/github-adapter.test.ts',
      headBranch: branch,
      baseBranch: defaultBranch,
      draft: false,
    });
    createdPRs.push(pr.number);

    expect(pr.number).toBeGreaterThan(0);
    expect(pr.url.startsWith('https://github.com/')).toBe(true);
    expect(pr.headBranch).toBe(branch);
    expect(pr.baseBranch).toBe(defaultBranch);
    expect(pr.state).toBe('open');
    expect(pr.createdAt).toBeInstanceOf(Date);

    // Touch defaultBranchSha so TS/lint don't flag the beforeAll as unused.
    expect(defaultBranchSha).toMatch(/^[0-9a-f]{40}$/);
  }, 60_000);
});
