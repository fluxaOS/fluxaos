/**
 * Path resolution for per-run artifacts directories.
 *
 * Sibling to path-resolver.ts. Artifacts live under
 * `<workspace_root>/.fluxaos-artifacts/<runId>/` and are distinct from
 * worktrees so stage outputs never get committed to the target repo.
 *
 * Resolution precedence (first non-empty wins):
 *   1. FLUXAOS_ARTIFACTS_ROOT — absolute. Dedicated override for artifacts.
 *   2. FLUXAOS_WORKSPACE_ROOT — absolute. Shared override with worktrees.
 *   3. <repoPath>/.fluxaos-artifacts/ — default in-project layout.
 *
 * Shape mirrors path-resolver.ts exactly so behavior is predictable across
 * R-RUNTIME and R-ARTIFACTS.
 */

import { isAbsolute, join, resolve } from 'node:path';

/**
 * Root directory under which per-run artifacts are stored for a given repo.
 *
 * If FLUXAOS_ARTIFACTS_ROOT is set (absolute), used as-is.
 * Else if FLUXAOS_WORKSPACE_ROOT is set (absolute), used as-is.
 * Else falls back to `<repoPath>/.fluxaos-artifacts/`.
 *
 * Throws if either env var is set to a non-absolute path.
 */
export function getArtifactsBase(repoPath: string): string {
  const artifactsOverride = process.env.FLUXAOS_ARTIFACTS_ROOT;
  if (artifactsOverride) {
    if (!isAbsolute(artifactsOverride)) {
      throw new Error(
        `FLUXAOS_ARTIFACTS_ROOT must be an absolute path, got '${artifactsOverride}'.`
      );
    }
    return artifactsOverride;
  }

  const workspaceOverride = process.env.FLUXAOS_WORKSPACE_ROOT;
  if (workspaceOverride) {
    if (!isAbsolute(workspaceOverride)) {
      throw new Error(
        `FLUXAOS_WORKSPACE_ROOT must be an absolute path, got '${workspaceOverride}'.`
      );
    }
    return workspaceOverride;
  }

  return join(resolve(repoPath), '.fluxaos-artifacts');
}

/**
 * Compose the absolute per-run artifacts directory.
 * `path.join` handles slash normalization — no double-slashes on linux.
 */
export function getArtifactsPath(repoPath: string, runId: string): string {
  return join(getArtifactsBase(repoPath), runId);
}
