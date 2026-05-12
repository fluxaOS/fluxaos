export type RepoCoordinates = {
  owner: string;
  repo: string;
};

export type ValidationFailureReason =
  | 'INVALID_URL'
  | 'UNSUPPORTED_HOST'
  | 'REPO_NOT_FOUND'
  | 'AUTH_FAILED'
  | 'NETWORK';

export type ValidationResult =
  | { ok: true; provider: string; coords: RepoCoordinates }
  | {
      ok: false;
      provider: string | null;
      reason: ValidationFailureReason;
      detail?: string;
    };

/**
 * Vendor-agnostic provider validator. Distinct from the richer GitProvider
 * port (`src/core/ports/git.ts`) — this is a thin "does this URL point at
 * a real, reachable repo?" interface. Adding a new vendor is a single file
 * implementing this interface plus a one-line registration in
 * validator-registry.ts. See spec §"Git router & adapter contract".
 */
export interface GitProviderValidator {
  readonly key: string;
  readonly supportedHosts: readonly string[];
  parse(url: URL): RepoCoordinates | null;
  exists(coords: RepoCoordinates): Promise<boolean>;
}
