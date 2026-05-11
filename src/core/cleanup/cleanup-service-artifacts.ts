/**
 * Cleanup service — R-ARTIFACTS W4 artifacts-reaping helpers.
 *
 * Extracted from cleanup-service.ts to keep that file under the 500-line
 * ceiling. The factory in cleanup-service.ts composes these free functions
 * with its `db`, `logger`, and injected `git` bag; nothing here imports
 * adapters (invariant 7).
 */

import { basename, dirname } from 'node:path';
import { eq, isNotNull } from 'drizzle-orm';
import { PIPELINE_RUN_TERMINAL } from '@/core/constants';
import type { Database } from '@/core/db/connection';
import { isolationEnvironment, pipelineRun } from '@/core/db/schema';
import type {
  CleanupGitHelpers,
  CleanupLogger,
  CleanupReport,
} from './cleanup-service';

export type ArtifactsSafetyReason =
  | 'stale'
  | 'active-run'
  | 'retention-not-reached';

/**
 * Gate for artifact-dir reap. The directory basename IS the pipeline_run
 * id, so we decide from (a) pipeline_run status and (b) the mtime age passed
 * by the caller (who already stat'd the dir).
 *
 * Verdicts:
 *   - 'active-run'             — pipeline_run exists, status non-terminal
 *   - 'retention-not-reached'  — terminal (or row missing) but ageMs < window
 *   - 'stale'                  — terminal/missing AND ageMs >= window
 *
 * `retentionDays` must be provided by the caller (injected from FluxaosConfig
 * via CleanupService). Passing undefined/null disables the gate defensively.
 */
export async function isArtifactsSafeToRemove(
  db: Database,
  runId: string,
  ageMs: number,
  retentionDays?: number
): Promise<ArtifactsSafetyReason> {
  const [run] = await db
    .select({ status: pipelineRun.status })
    .from(pipelineRun)
    .where(eq(pipelineRun.id, runId));

  const status = run?.status ?? null;
  if (status !== null && !PIPELINE_RUN_TERMINAL.has(status)) {
    return 'active-run';
  }

  if (retentionDays === undefined || retentionDays === null) {
    // Defensive: the sweep-level caller checks first, but guard here too.
    return 'retention-not-reached';
  }
  const retentionMs = retentionDays * 86_400_000;
  if (ageMs < retentionMs) {
    return 'retention-not-reached';
  }

  return 'stale';
}

/**
 * Discover distinct artifact-base directories from the recorded
 * `isolation_environment.artifacts_path` values (active + inactive).
 * base = `dirname(artifacts_path)`. Avoids hardcoding env-var repo paths
 * in core and supports multi-repo installs naturally.
 */
export async function listArtifactsBases(db: Database): Promise<string[]> {
  const rows = await db
    .select({ path: isolationEnvironment.artifactsPath })
    .from(isolationEnvironment)
    .where(isNotNull(isolationEnvironment.artifactsPath));
  const bases = new Set<string>();
  for (const r of rows) {
    if (r.path) bases.add(dirname(r.path));
  }
  return Array.from(bases);
}

/**
 * Second-pass sweep: reap stale artifact dirs. Mutates `report`.
 *
 * Contract:
 *   - Skip entirely (single warn log) when the retention env var is
 *     unset/unparseable. No invented threshold.
 *   - For each discovered base, list dirs and gate each via
 *     `isArtifactsSafeToRemove`.
 *   - Do NOT null out `pipeline_run.artifacts_path` or
 *     `isolation_environment.artifacts_path` — the DB keeps the
 *     historical record of where the artifacts dir lived.
 */
/**
 * Tear down the artifacts dir recorded on an env row when the operator
 * force-removes an environment. Swallows rm errors (env removal must not
 * fail because the dir was already gone).
 */
export async function forceRemoveArtifactsDir(
  logger: CleanupLogger,
  git: CleanupGitHelpers,
  envId: string,
  artifactsPath: string | null,
  warnings: string[]
): Promise<void> {
  if (!artifactsPath) return;
  try {
    await git.removeArtifactsDir(artifactsPath);
    logger.info(
      { envId, path: artifactsPath },
      'cleanup.artifacts.force_removed'
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`artifacts-remove: ${message}`);
    logger.warn(
      { envId, path: artifactsPath, error: message },
      'cleanup.artifacts.force_remove_failed'
    );
  }
}

export async function sweepArtifacts(
  db: Database,
  logger: CleanupLogger,
  git: CleanupGitHelpers,
  report: CleanupReport,
  retentionDays?: number
): Promise<void> {
  if (retentionDays === undefined || retentionDays === null) {
    // FLX-224: retention now lives in `config_entry` (key
    // `cleanup.artifacts_retention_days`). The cleanup-service reader
    // throws when the row is missing, so this branch is now a defensive
    // shim for callers that pass the value explicitly — primarily the
    // unit-style integration tests that pass `undefined` to mean "skip".
    logger.warn(
      { configKey: 'cleanup.artifacts_retention_days' },
      'cleanup.artifacts.skipped.missing_config'
    );
    return;
  }

  const bases = await listArtifactsBases(db);
  logger.info(
    { baseCount: bases.length, retentionDays },
    'cleanup.artifacts.sweep_start'
  );

  const now = Date.now();
  for (const base of bases) {
    let dirs: string[];
    try {
      dirs = await git.listArtifactDirs(base);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.errors.push({ envId: `artifacts:${base}`, error: message });
      continue;
    }

    for (const dir of dirs) {
      const runId = basename(dir);
      try {
        const mtime = await git.getArtifactsDirAge(dir);
        const ageMs = now - mtime.getTime();
        const verdict = await isArtifactsSafeToRemove(
          db,
          runId,
          ageMs,
          retentionDays
        );
        if (verdict !== 'stale') {
          report.skipped.push({
            envId: `artifacts:${runId}`,
            reason: verdict,
          });
          continue;
        }
        await git.removeArtifactsDir(dir);
        logger.info({ runId, path: dir }, 'cleanup.artifacts.reaped');
        report.removed.push({
          envId: `artifacts:${runId}`,
          branchName: '',
          reason: 'artifacts-stale',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        report.errors.push({
          envId: `artifacts:${runId}`,
          error: message,
        });
      }
    }
  }
}
