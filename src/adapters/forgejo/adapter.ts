/**
 * FLX-4 — Forgejo GitProvider stub.
 *
 * Forgejo is a Gitea soft-fork; the REST API is mostly compatible.
 * Every method throws NotImplementedError. A future PR will wire these
 * to the Forgejo REST API (likely sharing significant code with the
 * Gitea adapter once that's implemented).
 */

import type { CreatePRParams, GitProvider } from '@/core/ports/git';

export class ForgejoNotImplementedError extends Error {
  constructor(methodName: string) {
    super(
      `ForgejoAdapter.${methodName} is not implemented (FLX-4 stub). ` +
        'See docs/superpowers/roadmap.md.'
    );
    this.name = 'ForgejoNotImplementedError';
  }
}

export function createForgejoAdapter(): GitProvider {
  const reject = (method: string) =>
    Promise.reject(new ForgejoNotImplementedError(method));
  return {
    providerName: () => 'forgejo',
    createBranch: () => reject('createBranch'),
    createPullRequest: (_: CreatePRParams) => reject('createPullRequest'),
    getPullRequest: () => reject('getPullRequest'),
    listPullRequests: () => reject('listPullRequests'),
    mergePullRequest: () => reject('mergePullRequest'),
  };
}
