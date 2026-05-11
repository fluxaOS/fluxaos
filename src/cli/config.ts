/**
 * CLI configuration — env-driven, fail-fast.
 *
 * The CLI is a thin tRPC HTTP client. It does not import from `@/core/` and
 * never touches the database directly. All operator state lives in the
 * running fluxaOS app server; the CLI just speaks to its tRPC surface.
 *
 * Required env:
 *   FLUXAOS_API_URL          — full tRPC endpoint, e.g. http://localhost:3004/api/trpc
 *   FLUXAOS_CLI_ORG_SLUG     — org slug to target
 *   FLUXAOS_CLI_USER_SLUG    — user slug to target
 *   FLUXAOS_CLI_PROJECT_SLUG — project slug to target
 *
 * All four must be set — no silent defaults. CLI invocations must name the
 * project explicitly so renaming the seeded project (or operating against a
 * non-seeded project) does not silently route to a stale slug.
 *
 * Auth model (current scope):
 *   FLUXAOS_LAN_AUTH_BYPASS=1 must be set on the server. This is the
 *   homelab norm and the only auth path supported by the CLI today; real
 *   Supabase OAuth flow is out of scope for FLX-2. The CLI itself does not
 *   read this var — it only checks it via `system.health` so the operator
 *   gets a clear message when the server is locked down.
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

function requireEnv(name: string, example: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new CliConfigError(`${name} is not set. Example: ${name}=${example}`);
  }
  return value;
}

export function loadConfig(): CliConfig {
  const apiUrl = requireEnv(
    'FLUXAOS_API_URL',
    'http://localhost:3004/api/trpc'
  );
  try {
    new URL(apiUrl);
  } catch {
    throw new CliConfigError(`FLUXAOS_API_URL is not a valid URL: ${apiUrl}`);
  }

  return {
    apiUrl,
    orgSlug: requireEnv('FLUXAOS_CLI_ORG_SLUG', 'default'),
    userSlug: requireEnv('FLUXAOS_CLI_USER_SLUG', 'admin'),
    projectSlug: requireEnv('FLUXAOS_CLI_PROJECT_SLUG', 'my-project'),
  };
}
