/**
 * FLX-4 — GitLab GitProvider stub.
 *
 * Every method throws NotImplementedError. A future PR will wire these
 * to the GitLab REST API following the same pattern as the GitHub
 * adapter (see src/adapters/github/adapter.ts).
 */

import type {
  CreatePRParams,
  GitProvider,
  PullRequest,
} from '@/core/ports/git';

export class GitLabNotImplementedError extends Error {
  constructor(methodName: string) {
    super(
      `GitLabAdapter.${methodName} is not implemented (FLX-4 stub). ` +
        'See docs/superpowers/roadmap.md.'
    );
    this.name = 'GitLabNotImplementedError';
  }
}

export function createGitLabAdapter(): GitProvider {
  const reject = (method: string) =>
    Promise.reject(new GitLabNotImplementedError(method));
  return {
    createBranch: () => reject('createBranch'),
    createPullRequest: (_: CreatePRParams) => reject('createPullRequest'),
    getPullRequest: () => reject('getPullRequest'),
    listPullRequests: () => reject('listPullRequests'),
    mergePullRequest: () => reject('mergePullRequest'),
  };
}
