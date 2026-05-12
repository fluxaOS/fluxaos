import { AuthError, NetworkError } from '../errors';
import type { GitProviderValidator, RepoCoordinates } from '../validation-types';

export function gitHubValidator({
  token,
}: {
  token: string;
}): GitProviderValidator {
  return {
    key: 'github',
    supportedHosts: ['github.com', 'www.github.com'],

    parse(url) {
      // Accepts https://github.com/owner/repo and https://github.com/owner/repo.git
      const m = url.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
      if (!m) return null;
      return { owner: m[1], repo: m[2] };
    },

    async exists({ owner, repo }: RepoCoordinates): Promise<boolean> {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      );
      if (res.status === 404) return false;
      if (res.status === 401 || res.status === 403) {
        throw new AuthError(res.statusText || `GitHub ${res.status}`);
      }
      if (!res.ok) {
        throw new NetworkError(`GitHub ${res.status}`);
      }
      return true;
    },
  };
}
