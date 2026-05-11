/**
 * FLX-4 — GitProviderFactory: route a repo URL to the right forge adapter.
 *
 * Detection rules (in order):
 *   1. Host contains 'github' → GitHub adapter (the only fully-implemented
 *      one in alpha; the rest are stubs).
 *   2. Host contains 'gitlab' → GitLab stub.
 *   3. Host contains 'forgejo' or 'codeberg' (the largest Forgejo-hosted
 *      community) → Forgejo stub.
 *   4. Host contains 'gitea' → Gitea stub.
 *   5. Anything else (including empty repoUrl) → `'unknown'`. `forUrl`
 *      raises {@link UnsupportedGitHostError} so the runtime fails fast
 *      rather than silently routing through GitHub (FLX-218).
 *
 * Adapters are constructed lazily (per call) so tokens can be missing
 * at registration time and only fail when the adapter is actually
 * exercised — same contract as the alpha GitHub adapter.
 */

import { createForgejoAdapter } from '@/adapters/forgejo/adapter';
import { createGiteaAdapter } from '@/adapters/gitea/adapter';
import { createGitHubAdapter } from '@/adapters/github/adapter';
import { createGitLabAdapter } from '@/adapters/gitlab/adapter';
import { UnsupportedGitHostError } from '@/core/errors/git';
import type { GitProvider } from '@/core/ports/git';
import type { GitProviderFactory, KnownForge } from '@/core/ports/git-factory';

export function detectForge(repoUrl: string): KnownForge {
  if (!repoUrl) return 'unknown';
  const host = extractHost(repoUrl).toLowerCase();
  if (host.includes('github')) return 'github';
  if (host.includes('gitlab')) return 'gitlab';
  if (host.includes('forgejo') || host.includes('codeberg')) return 'forgejo';
  if (host.includes('gitea')) return 'gitea';
  return 'unknown';
}

function extractHost(repoUrl: string): string {
  try {
    return new URL(repoUrl).host;
  } catch {
    // git@host:owner/repo SSH form, or bare 'owner/repo' string.
    const sshMatch = repoUrl.match(/^[^@]+@([^:]+):/);
    if (sshMatch) return sshMatch[1];
    return '';
  }
}

export function createGitProviderFactory(): GitProviderFactory {
  return {
    detectForge,
    forUrl(repoUrl: string): GitProvider {
      const forge = detectForge(repoUrl);
      switch (forge) {
        case 'github':
          return createGitHubAdapter();
        case 'gitlab':
          return createGitLabAdapter();
        case 'forgejo':
          return createForgejoAdapter();
        case 'gitea':
          return createGiteaAdapter();
        case 'unknown':
          throw new UnsupportedGitHostError(repoUrl);
      }
    },
  };
}
