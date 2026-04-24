/**
 * Filesystem helpers for R-ARTIFACTS artifacts directories.
 *
 * Pure shell-outs over node:fs/promises — no state, no DB. Cleanup service
 * and isolation provider consume these via DI. Each function is idempotent
 * where that makes sense (mkdir, rm).
 *
 * The reason this adapter family lives at `src/adapters/fs/` and not
 * `src/adapters/git/` is that artifacts are not git-tracked; grouping them
 * under `git/` would imply lifecycle rules they don't have.
 */

import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Create the artifacts directory (and any missing parents). Idempotent —
 * no error if the directory already exists.
 */
export async function ensureArtifactsDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

/**
 * Remove the artifacts directory and all its contents. Tolerates a missing
 * path silently (no ENOENT thrown).
 */
export async function removeArtifactsDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

/**
 * List direct subdirectories of `base`, returning absolute paths. Files at
 * the top level are ignored. Returns an empty array if `base` doesn't exist
 * — cleanup callers shouldn't care whether artifacts were ever created.
 */
export async function listArtifactDirs(base: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(base, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(base, entry.name));
}

/**
 * Return the mtime of the artifacts directory. Throws if `path` does not
 * exist — callers are expected to gate with their own existence check
 * (or rely on listArtifactDirs to only hand them paths that are real).
 */
export async function getArtifactsDirAge(path: string): Promise<Date> {
  const stats = await stat(path);
  return stats.mtime;
}
