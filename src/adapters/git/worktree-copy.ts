/**
 * Copy gitignored files from the canonical repo into a newly-created
 * worktree (git worktree add does NOT include gitignored files, so `.env`,
 * fixtures, etc. won't be present without this step).
 *
 * Safety:
 *   - path-traversal check rejects `../etc/passwd` style entries
 *   - ENOENT on source is silently skipped (expected when a project's
 *     copy list references files that don't exist on every checkout)
 *   - Other IO errors are logged and reported but do not abort the run
 *
 * Shape borrowed from Archon's packages/isolation/src/worktree-copy.ts
 * (MIT, shape-only).
 */

import { cp, mkdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative } from 'node:path';

export interface CopyFileEntry {
  source: string;
  destination: string;
}

export interface CopyResult {
  entry: string;
  copied: boolean;
  reason?: string;
}

export interface CopyReport {
  sourceRoot: string;
  destRoot: string;
  entries: CopyResult[];
}

export function parseCopyFileEntry(entry: string): CopyFileEntry {
  const trimmed = entry.trim();
  if (!trimmed) {
    throw new Error('Copy entry cannot be empty.');
  }
  return { source: trimmed, destination: trimmed };
}

export function isPathWithinRoot(root: string, filePath: string): boolean {
  const fullPath = normalize(join(root, filePath));
  const normalizedRoot = normalize(root);
  const relativePath = relative(normalizedRoot, fullPath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return false;
  }
  return true;
}

export async function copyWorktreeFile(
  sourceRoot: string,
  destRoot: string,
  entry: CopyFileEntry
): Promise<CopyResult> {
  if (!isPathWithinRoot(sourceRoot, entry.source)) {
    return {
      entry: entry.source,
      copied: false,
      reason: 'path-traversal rejected',
    };
  }
  if (!isPathWithinRoot(destRoot, entry.destination)) {
    return {
      entry: entry.source,
      copied: false,
      reason: 'path-traversal rejected',
    };
  }

  const source = join(sourceRoot, entry.source);
  const destination = join(destRoot, entry.destination);

  let isDirectory: boolean;
  try {
    const s = await stat(source);
    isDirectory = s.isDirectory();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        entry: entry.source,
        copied: false,
        reason: 'source does not exist',
      };
    }
    return {
      entry: entry.source,
      copied: false,
      reason: `stat failed: ${(err as Error).message}`,
    };
  }

  try {
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, {
      recursive: isDirectory,
      dereference: false,
      errorOnExist: false,
      force: true,
    });
    return { entry: entry.source, copied: true };
  } catch (err) {
    return {
      entry: entry.source,
      copied: false,
      reason: `copy failed: ${(err as Error).message}`,
    };
  }
}

export async function copyConfiguredFiles(
  sourceRoot: string,
  destRoot: string,
  rawEntries: readonly string[]
): Promise<CopyReport> {
  const entries: CopyResult[] = [];
  for (const raw of rawEntries) {
    try {
      const entry = parseCopyFileEntry(raw);
      const result = await copyWorktreeFile(sourceRoot, destRoot, entry);
      entries.push(result);
    } catch (err) {
      entries.push({
        entry: raw,
        copied: false,
        reason: `parse failed: ${(err as Error).message}`,
      });
    }
  }
  return { sourceRoot, destRoot, entries };
}
