/**
 * Path resolution for per-run artifacts directories.
 *
 * Sibling to path-resolver.ts. Artifacts live under
 * `<workspace_root>/.fluxaos-artifacts/<runId>/` and are distinct from
 * worktrees so stage outputs never get committed to the target repo.
 *
 * Resolution precedence (first non-empty wins):
 *   1. opts.artifactsRoot — absolute. Dedicated override for artifacts.
 *   2. opts.workspaceRoot — absolute. Shared override with worktrees.
 *   3. <repoPath>/.fluxaos-artifacts/ — default in-project layout.
 *
 * Shape mirrors path-resolver.ts exactly so behavior is predictable across
 * R-RUNTIME and R-ARTIFACTS.
 */

import { isAbsolute, join, resolve } from 'node:path';

export interface ArtifactsPathOpts {
  /** Dedicated artifacts-root override (FLUXAOS_ARTIFACTS_ROOT). */
  artifactsRoot?: string | undefined;
  /** Shared workspace-root override (FLUXAOS_WORKSPACE_ROOT). */
  workspaceRoot?: string | undefined;
}

/**
 * Root directory under which per-run artifacts are stored for a given repo.
 *
 * If opts.artifactsRoot is set (absolute), used as-is.
 * Else if opts.workspaceRoot is set (absolute), used as-is.
 * Else falls back to `<repoPath>/.fluxaos-artifacts/`.
 *
 * Throws if either override is set to a non-absolute path.
 */
export function getArtifactsBase(
  repoPath: string,
  opts: ArtifactsPathOpts = {}
): string {
  const { artifactsRoot, workspaceRoot } = opts;

  if (artifactsRoot) {
    if (!isAbsolute(artifactsRoot)) {
      throw new Error(
        `FLUXAOS_ARTIFACTS_ROOT must be an absolute path, got '${artifactsRoot}'.`
      );
    }
    return artifactsRoot;
  }

  if (workspaceRoot) {
    if (!isAbsolute(workspaceRoot)) {
      throw new Error(
        `FLUXAOS_WORKSPACE_ROOT must be an absolute path, got '${workspaceRoot}'.`
      );
    }
    return workspaceRoot;
  }

  return join(resolve(repoPath), '.fluxaos-artifacts');
}

/**
 * Compose the absolute per-run artifacts directory.
 * `path.join` handles slash normalization — no double-slashes on linux.
 */
export function getArtifactsPath(
  repoPath: string,
  runId: string,
  opts: ArtifactsPathOpts = {}
): string {
  return join(getArtifactsBase(repoPath, opts), runId);
}
