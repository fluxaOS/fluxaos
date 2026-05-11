/**
 * FLX-4 — multi-forge GitProvider factory.
 *
 * The deploy bridge resolves a GitProvider *per-repo* using
 * `GitProviderFactory.forUrl()`, which inspects the URL host and
 * returns the right adapter (GitHub, GitLab, Gitea, or Forgejo). The
 * non-GitHub adapters are stubs in this slice — every method throws
 * NotImplementedError until they're wired post-alpha.
 *
 * The factory is the only git resolution path. Call sites that do not
 * have a repo URL should pass an empty string; the factory's
 * detect-and-route logic handles the unknown-host case.
 */

import type { GitProvider } from './git';

export interface GitProviderFactory {
  /** Returns the adapter that owns the given repo URL. */
  forUrl(repoUrl: string): GitProvider;

  /** Maps a URL to a forge name (for logging / UI). */
  detectForge(repoUrl: string): KnownForge;
}

export type KnownForge = 'github' | 'gitlab' | 'gitea' | 'forgejo' | 'unknown';
