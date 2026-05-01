/**
 * FLX-4 — Gitea GitProvider stub.
 *
 * Every method throws NotImplementedError. A future PR will wire these
 * to the Gitea REST API following the same pattern as the GitHub
 * adapter (see src/adapters/github/adapter.ts).
 */

import type { CreatePRParams, GitProvider } from '@/core/ports/git';

export class GiteaNotImplementedError extends Error {
  constructor(methodName: string) {
    super(
      `GiteaAdapter.${methodName} is not implemented (FLX-4 stub). ` +
        'See docs/superpowers/roadmap.md.'
    );
    this.name = 'GiteaNotImplementedError';
  }
}

export function createGiteaAdapter(): GitProvider {
  const reject = (method: string) =>
    Promise.reject(new GiteaNotImplementedError(method));
  return {
    createBranch: () => reject('createBranch'),
    createPullRequest: (_: CreatePRParams) => reject('createPullRequest'),
    getPullRequest: () => reject('getPullRequest'),
    listPullRequests: () => reject('listPullRequests'),
    mergePullRequest: () => reject('mergePullRequest'),
  };
}
