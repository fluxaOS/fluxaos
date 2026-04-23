/**
 * Internal type aliases for the GitHub adapter.
 *
 * These are NOT part of the public `GitProvider` surface — callers consume
 * `GitProvider`, `CreatePRParams`, and `PullRequest` from
 * `src/core/ports/git.ts`. The shapes below capture only the Octokit response
 * fields the adapter actually reads, so we can avoid `any` casts when mapping
 * API responses to domain objects.
 */

import type { RestEndpointMethodTypes } from '@octokit/rest';

/** `octokit.rest.repos.get` response data — we read `default_branch`. */
export type RepoGetResponseData =
  RestEndpointMethodTypes['repos']['get']['response']['data'];

/** `octokit.rest.git.getRef` response data — we read `object.sha`. */
export type GitGetRefResponseData =
  RestEndpointMethodTypes['git']['getRef']['response']['data'];

/** `octokit.rest.pulls.create` response data — mapped to `PullRequest`. */
export type PullsCreateResponseData =
  RestEndpointMethodTypes['pulls']['create']['response']['data'];
