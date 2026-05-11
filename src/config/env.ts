/**
 * FluxaosConfig — centralized FLUXAOS_* environment variable definitions.
 *
 * All FLUXAOS_* vars are read and parsed once here at bootstrap, then
 * injected into the services that need them. Nothing in src/core/ should
 * import process.env directly — use the injected FluxaosConfig instead.
 *
 * Optional vars are undefined when not set (feature-disabled or
 * caller-throws semantics preserved per original behaviour).
 *
 * Required vars throw a startup error when missing or invalid — operator
 * owns the values; no silent defaults.
 */

export interface FluxaosConfig {
  /** Absolute path to the on-disk clone of the target repo (R-RUNTIME alpha). */
  targetRepoPath: string | undefined;
  /** How often the cleanup sweep runs (minutes). Required — no default. */
  cleanupSweepIntervalMin: number;
  /** Maximum worktree age (in days) before a worktree is considered stale. Required — no default. */
  cleanupStaleDays: number;
  /** Minimum age (in days) for a terminal session before it is reaped. Required — no default. */
  cleanupSessionRetentionDays: number;
  /** Minimum age (in days) before a terminal pipeline_run artifacts dir is reaped. Required — no default. */
  cleanupArtifactsRetentionDays: number;
  /** Path to the init-result-doc script invoked via node. Required — no default. */
  initResultDocScript: string;
  /** Path to the ingest-result-doc script invoked via node. Required — no default. */
  ingestResultDocScript: string;
}

const REQUIRED_CLEANUP_VARS = [
  'FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN',
  'FLUXAOS_CLEANUP_STALE_DAYS',
  'FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS',
  'FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS',
] as const;

function parseRequiredPositiveInt(name: string): number {
  const raw = process.env[name];
  if (!raw) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        'Set to a positive integer — operator owns this threshold (no default).'
    );
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer; got "${raw}".`);
  }
  return Number(raw);
}

function parseRequiredString(name: string): string {
  const raw = process.env[name];
  if (!raw) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        'Operator owns this value — no silent default.'
    );
  }
  return raw;
}

export function loadFluxaosConfig(): FluxaosConfig {
  return {
    targetRepoPath: process.env.FLUXAOS_TARGET_REPO_PATH,
    cleanupSweepIntervalMin: parseRequiredPositiveInt(REQUIRED_CLEANUP_VARS[0]),
    cleanupStaleDays: parseRequiredPositiveInt(REQUIRED_CLEANUP_VARS[1]),
    cleanupSessionRetentionDays: parseRequiredPositiveInt(
      REQUIRED_CLEANUP_VARS[2]
    ),
    cleanupArtifactsRetentionDays: parseRequiredPositiveInt(
      REQUIRED_CLEANUP_VARS[3]
    ),
    initResultDocScript: parseRequiredString('FLUXAOS_INIT_RESULT_DOC_SCRIPT'),
    ingestResultDocScript: parseRequiredString(
      'FLUXAOS_INGEST_RESULT_DOC_SCRIPT'
    ),
  };
}
