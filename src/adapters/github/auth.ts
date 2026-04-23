/**
 * GitHub authentication helper — reads FLUXAOS_GITHUB_TOKEN from env and
 * returns an authenticated Octokit instance. Lazy-safe: importing this
 * module must not throw. Errors are only raised when
 * `getAuthenticatedOctokit()` is actually called.
 */

import { Octokit } from '@octokit/rest';

/**
 * Thrown when an Octokit instance is requested but no FLUXAOS_GITHUB_TOKEN
 * is present in the environment.
 */
export class GitHubAuthError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'FLUXAOS_GITHUB_TOKEN is not set. Set the environment variable to a ' +
          'GitHub personal access token (or fine-grained token) with repo + ' +
          'pull_request scopes so the GitHub adapter can authenticate.'
    );
    this.name = 'GitHubAuthError';
  }
}

/**
 * Build an authenticated Octokit client from the process environment.
 *
 * Evaluated lazily (not at module load time) so the adapter module can be
 * safely imported without the token being present — useful for tests and
 * for callers that inject their own Octokit instance.
 */
export function getAuthenticatedOctokit(): Octokit {
  const token = process.env.FLUXAOS_GITHUB_TOKEN;
  if (!token) {
    throw new GitHubAuthError();
  }
  return new Octokit({ auth: token });
}
