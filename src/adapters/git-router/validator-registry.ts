import { isAuthError, isNetworkError } from './errors';
import type {
  GitProviderValidator,
  ValidationResult,
} from './validation-types';
import { gitHubValidator } from './validators/github';

export class GitRouter {
  constructor(private readonly validators: readonly GitProviderValidator[]) {}

  async validate(rawUrl: string): Promise<ValidationResult> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { ok: false, provider: null, reason: 'INVALID_URL' };
    }

    const adapter = this.validators.find((a) =>
      a.supportedHosts.includes(url.hostname)
    );
    if (!adapter) {
      return { ok: false, provider: null, reason: 'UNSUPPORTED_HOST' };
    }

    const coords = adapter.parse(url);
    if (!coords) {
      return { ok: false, provider: adapter.key, reason: 'INVALID_URL' };
    }

    try {
      const found = await adapter.exists(coords);
      return found
        ? { ok: true, provider: adapter.key, coords }
        : { ok: false, provider: adapter.key, reason: 'REPO_NOT_FOUND' };
    } catch (err) {
      if (isAuthError(err)) {
        return {
          ok: false,
          provider: adapter.key,
          reason: 'AUTH_FAILED',
          detail: String(err),
        };
      }
      if (isNetworkError(err)) {
        return {
          ok: false,
          provider: adapter.key,
          reason: 'NETWORK',
          detail: String(err),
        };
      }
      throw err;
    }
  }

  /** Hostnames that any registered validator claims — used by the page to
   *  render the supported-hosts hint in UNSUPPORTED_HOST error copy.
   *  Vendor-agnostic: the page never spells "github". */
  supportedHosts(): readonly string[] {
    return this.validators.flatMap((v) => v.supportedHosts);
  }
}

/**
 * Build the slice's vendor-agnostic repo-URL validator chain. Distinct from
 * `createGitProviderFactory()` in `factory.ts` (FLX-4 / FLX-218) which
 * builds the richer GitProvider used by stage-runner-env / deploy-bridge.
 *
 * Adding a new validator = one new file in `validators/` + one line here.
 */
export function buildGitRouter(): GitRouter {
  const token = process.env.FLUXAOS_GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      'FLUXAOS_GITHUB_TOKEN is required for repo URL validation. ' +
        'See CLAUDE.md → R-RUNTIME env vars.'
    );
  }
  return new GitRouter([
    gitHubValidator({ token }),
    // gitLabValidator({ token: process.env.FLUXAOS_GITLAB_TOKEN }),  // future
    // forgejoValidator({ ... }),                                       // future
  ]);
}
