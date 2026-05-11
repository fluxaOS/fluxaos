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
 *
 * Migration history:
 *   - FLX-222: workspaceRoot moved out of FluxaosConfig (now `runtime.workspace_root` config_entry).
 *   - FLX-223: artifactsRoot moved out of FluxaosConfig (now `runtime.artifacts_root` config_entry).
 *   - FLX-224: cleanup* + run-cleanup-scheduler moved out of FluxaosConfig
 *     (now five `cleanup.*` config_entry rows). The cleanup scheduler reads
 *     them from the DB on each sweep tick.
 *   - FLX-221: targetRepoPath moved out of FluxaosConfig (now
 *     `project.target_repo_path` column — per-project, not global). The
 *     stage-runner reads it directly from the project row at acquire time
 *     and fails fast with MissingProjectTargetRepoPathError when null.
 */

export interface FluxaosConfig {
  /** Path to the init-result-doc script invoked via node. Required — no default. */
  initResultDocScript: string;
  /** Path to the ingest-result-doc script invoked via node. Required — no default. */
  ingestResultDocScript: string;
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
    initResultDocScript: parseRequiredString('FLUXAOS_INIT_RESULT_DOC_SCRIPT'),
    ingestResultDocScript: parseRequiredString(
      'FLUXAOS_INGEST_RESULT_DOC_SCRIPT'
    ),
  };
}
