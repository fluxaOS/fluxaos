/**
 * FLX-4 — multi-forge GitProvider factory.
 *
 * Today the adapter registry exposes a single `'git'` adapter (the
 * GitHub one). With FLX-4, the deploy bridge resolves a GitProvider
 * *per-repo* using `GitProviderFactory.forUrl()`, which inspects the
 * URL host and returns the right adapter (GitHub, GitLab, Gitea, or
 * Forgejo). The non-GitHub adapters are stubs in this slice — every
 * method throws NotImplementedError until they're wired post-alpha.
 *
 * Older call sites that don't know the repo URL still resolve a
 * GitProvider via `registry.get<GitProvider>('git')` (the GitHub
 * adapter is the alpha default). New call sites should prefer the
 * factory.
 */

import type { GitProvider } from './git';

export interface GitProviderFactory {
  /** Returns the adapter that owns the given repo URL. */
  forUrl(repoUrl: string): GitProvider;

  /** Maps a URL to a forge name (for logging / UI). */
  detectForge(repoUrl: string): KnownForge;
}

export type KnownForge = 'github' | 'gitlab' | 'gitea' | 'forgejo' | 'unknown';
