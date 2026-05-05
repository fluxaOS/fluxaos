/**
 * FluxaosConfig — centralized FLUXAOS_* environment variable definitions.
 *
 * All FLUXAOS_* vars are read and parsed once here at bootstrap, then
 * injected into the services that need them. Nothing in src/core/ should
 * import process.env directly — use the injected FluxaosConfig instead.
 *
 * Optional vars are undefined when not set (feature-disabled or
 * caller-throws semantics preserved per original behaviour).
 */

export interface FluxaosConfig {
  /** Root directory for per-run artifact dirs. Optional — adapters have an in-repo default. */
  artifactsRoot: string | undefined;
  /** Absolute path to the on-disk clone of the target repo (R-RUNTIME alpha). */
  targetRepoPath: string | undefined;
  /** Maximum worktree age (in days) before a worktree is considered stale. */
  cleanupStaleDays: number | undefined;
  /** Minimum age (in days) before a terminal pipeline_run artifacts dir is reaped. */
  cleanupArtifactsRetentionDays: number | undefined;
  /** Path to the init-result-doc script passed to tsx. Defaults to the in-repo relative path. */
  initResultDocScript: string;
  /** Path to the ingest-result-doc script passed to tsx. Defaults to the in-repo relative path. */
  ingestResultDocScript: string;
}

export function loadFluxaosConfig(): FluxaosConfig {
  return {
    artifactsRoot: process.env.FLUXAOS_ARTIFACTS_ROOT,
    targetRepoPath: process.env.FLUXAOS_TARGET_REPO_PATH,
    cleanupStaleDays: process.env.FLUXAOS_CLEANUP_STALE_DAYS
      ? Number(process.env.FLUXAOS_CLEANUP_STALE_DAYS)
      : undefined,
    cleanupArtifactsRetentionDays: process.env
      .FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS
      ? Number(process.env.FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS)
      : undefined,
    initResultDocScript:
      process.env.FLUXAOS_INIT_RESULT_DOC_SCRIPT ??
      'src/scripts/pipeline/init-result-doc.ts',
    ingestResultDocScript:
      process.env.FLUXAOS_INGEST_RESULT_DOC_SCRIPT ??
      'src/scripts/pipeline/ingest-result-doc.ts',
  };
}
