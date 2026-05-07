/**
 * CLI configuration — env-driven, fail-fast.
 *
 * The CLI is a thin tRPC HTTP client. It does not import from `@/core/` and
 * never touches the database directly. All operator state lives in the
 * running fluxaOS app server; the CLI just speaks to its tRPC surface.
 *
 * Required env:
 *   FLUXAOS_API_URL — full tRPC endpoint, e.g. http://localhost:3004/api/trpc
 *
 * Auth model (current scope):
 *   FLUXAOS_LAN_AUTH_BYPASS=1 must be set on the server. This is the
 *   homelab norm and the only auth path supported by the CLI today; real
 *   Supabase OAuth flow is out of scope for FLX-2. The CLI itself does not
 *   read this var — it only checks it via `system.health` so the operator
 *   gets a clear message when the server is locked down.
 *
 * Project context (single-tenant assumption):
 *   FLUXAOS_CLI_ORG_SLUG     — default "default"
 *   FLUXAOS_CLI_USER_SLUG    — default "admin"
 *   FLUXAOS_CLI_PROJECT_SLUG — default "fluxaos"
 */
import 'dotenv/config';

export type CliConfig = {
  apiUrl: string;
  orgSlug: string;
  userSlug: string;
  projectSlug: string;
};

export class CliConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliConfigError';
  }
}

export function loadConfig(): CliConfig {
  const apiUrl = process.env.FLUXAOS_API_URL?.trim();
  if (!apiUrl) {
    throw new CliConfigError(
      'FLUXAOS_API_URL is not set. Example: FLUXAOS_API_URL=http://localhost:3004/api/trpc'
    );
  }
  try {
    new URL(apiUrl);
  } catch {
    throw new CliConfigError(`FLUXAOS_API_URL is not a valid URL: ${apiUrl}`);
  }

  return {
    apiUrl,
    orgSlug: process.env.FLUXAOS_CLI_ORG_SLUG?.trim() || 'default',
    userSlug: process.env.FLUXAOS_CLI_USER_SLUG?.trim() || 'admin',
    projectSlug: process.env.FLUXAOS_CLI_PROJECT_SLUG?.trim() || 'fluxaos',
  };
}
