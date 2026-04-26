/**
 * Integration tests: src/adapters/fs/artifacts.ts against a real tmpdir.
 *
 * No DB, no git. Pure filesystem assertions.
 */

import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureArtifactsDir,
  getArtifactsDirAge,
  listArtifactDirs,
  removeArtifactsDir,
} from '@/adapters/fs/artifacts';

describe('artifacts FS helpers', () => {
  let base: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'fluxaos-artifacts-fs-'));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('ensureArtifactsDir creates a new directory', async () => {
    const target = join(base, 'run-123');
    await ensureArtifactsDir(target);
    const s = await stat(target);
    expect(s.isDirectory()).toBe(true);
  });

  it('ensureArtifactsDir is idempotent on an existing directory', async () => {
    const target = join(base, 'run-123');
    await ensureArtifactsDir(target);
    // Second call must not throw.
    await expect(ensureArtifactsDir(target)).resolves.toBeUndefined();
    const s = await stat(target);
    expect(s.isDirectory()).toBe(true);
  });

  it('removeArtifactsDir removes a populated directory including nested subdirs', async () => {
    const target = join(base, 'run-123');
    await mkdir(join(target, 'stage-01-research'), { recursive: true });
    await writeFile(join(target, 'top.md'), 'top');
    await writeFile(join(target, 'stage-01-research', 'findings.md'), 'x');
    await removeArtifactsDir(target);
    await expect(stat(target)).rejects.toThrow();
  });

  it('removeArtifactsDir is silent when the path is missing', async () => {
    const missing = join(base, 'does-not-exist');
    await expect(removeArtifactsDir(missing)).resolves.toBeUndefined();
  });

  it('listArtifactDirs returns only subdirectories, ignoring files', async () => {
    await mkdir(join(base, 'run-a'), { recursive: true });
    await mkdir(join(base, 'run-b'), { recursive: true });
    await writeFile(join(base, 'loose.txt'), 'ignore me');
    const dirs = await listArtifactDirs(base);
    expect(dirs.sort()).toEqual(
      [join(base, 'run-a'), join(base, 'run-b')].sort()
    );
  });

  it('listArtifactDirs returns an empty array when the base is missing', async () => {
    const missing = join(base, 'no-such-root');
    const dirs = await listArtifactDirs(missing);
    expect(dirs).toEqual([]);
  });

  it('getArtifactsDirAge returns an mtime close to now on a freshly-created dir', async () => {
    const target = join(base, 'run-fresh');
    const before = Date.now();
    await ensureArtifactsDir(target);
    const mtime = await getArtifactsDirAge(target);
    const after = Date.now();
    // mtime should be between `before` and `after`, allowing for filesystem
    // granularity (some filesystems round to the nearest second).
    const tolerance = 2000; // ms — enough for coarse-grained filesystems.
    expect(mtime.getTime()).toBeGreaterThanOrEqual(before - tolerance);
    expect(mtime.getTime()).toBeLessThanOrEqual(after + tolerance);
  });
});
