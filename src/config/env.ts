/**
 * FluxaosConfig — centralized FLUXAOS_* environment variable definitions.
 *
 * All FLUXAOS_* vars are read and parsed once here at bootstrap, then
 * injected into the services that need them. Nothing in src/core/ should
 * import process.env directly — use the injected FluxaosConfig instead.
 *
 * Optional vars keep the same defaults they had before this refactor:
 * - bundledPipelinesDir defaults to 'src/core/pipeline/bundled'
 * - all others are undefined when not set (feature-disabled or
 *   caller-throws semantics preserved per original behaviour)
 */

export interface FluxaosConfig {
  /** Absolute or relative path to the bundled pipeline YAML files. */
  bundledPipelinesDir: string;
  /** Root directory for per-run artifact dirs. Optional — adapters have an in-repo default. */
  artifactsRoot: string | undefined;
  /** Absolute path to the on-disk clone of the target repo (R-RUNTIME alpha). */
  targetRepoPath: string | undefined;
  /** Maximum worktree age (in days) before a worktree is considered stale. */
  cleanupStaleDays: number | undefined;
  /** Minimum age (in days) before a terminal pipeline_run artifacts dir is reaped. */
  cleanupArtifactsRetentionDays: number | undefined;
}

export function loadFluxaosConfig(): FluxaosConfig {
  return {
    bundledPipelinesDir:
      process.env.FLUXAOS_BUNDLED_PIPELINES_DIR ?? 'src/core/pipeline/bundled',
    artifactsRoot: process.env.FLUXAOS_ARTIFACTS_ROOT,
    targetRepoPath: process.env.FLUXAOS_TARGET_REPO_PATH,
    cleanupStaleDays: process.env.FLUXAOS_CLEANUP_STALE_DAYS
      ? Number(process.env.FLUXAOS_CLEANUP_STALE_DAYS)
      : undefined,
    cleanupArtifactsRetentionDays: process.env
      .FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS
      ? Number(process.env.FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS)
      : undefined,
  };
}
