/**
 * Integration tests: src/adapters/git/gitignore.ts against a real tmpdir.
 *
 * The shared ensureGitignoreEntry helper is used by worktree-isolation-
 * provider (R-RUNTIME) and will be used by the artifacts call path
 * (R-ARTIFACTS W3). These tests exercise the generalized behaviour; the
 * isolation-provider.test.ts file covers the R-RUNTIME-specific call site.
 */

import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureGitignoreEntry } from '@/adapters/git/gitignore';

describe('ensureGitignoreEntry', () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await mkdtemp(join(tmpdir(), 'fluxaos-gitignore-'));
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  it('appends the entry (with comment) when .gitignore exists but lacks it', async () => {
    const gitignorePath = join(repoPath, '.gitignore');
    await writeFile(gitignorePath, 'node_modules/\n', 'utf-8');

    await ensureGitignoreEntry(
      repoPath,
      '.fluxaos-artifacts/',
      'fluxaOS per-run artifacts'
    );

    const content = await readFile(gitignorePath, 'utf-8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('# fluxaOS per-run artifacts');
    expect(content).toContain('.fluxaos-artifacts/');
  });

  it('is a no-op when the exact entry is already present', async () => {
    const gitignorePath = join(repoPath, '.gitignore');
    const initial = 'node_modules/\n# existing comment\n.fluxaos-artifacts/\n';
    await writeFile(gitignorePath, initial, 'utf-8');

    await ensureGitignoreEntry(
      repoPath,
      '.fluxaos-artifacts/',
      'fluxaOS per-run artifacts'
    );

    const content = await readFile(gitignorePath, 'utf-8');
    expect(content).toBe(initial);
  });

  it('is a no-op when an alternative form (/entry/) is already present', async () => {
    const gitignorePath = join(repoPath, '.gitignore');
    const initial = 'node_modules/\n/.fluxaos-artifacts/\n';
    await writeFile(gitignorePath, initial, 'utf-8');

    await ensureGitignoreEntry(
      repoPath,
      '.fluxaos-artifacts/',
      'fluxaOS per-run artifacts'
    );

    const content = await readFile(gitignorePath, 'utf-8');
    expect(content).toBe(initial);
  });

  it('creates .gitignore with the entry when the file does not exist', async () => {
    const gitignorePath = join(repoPath, '.gitignore');
    // Pre-assert the file is absent.
    await expect(stat(gitignorePath)).rejects.toThrow();

    await ensureGitignoreEntry(
      repoPath,
      '.fluxaos-artifacts/',
      'fluxaOS per-run artifacts'
    );

    const content = await readFile(gitignorePath, 'utf-8');
    expect(content).toContain('# fluxaOS per-run artifacts');
    expect(content).toContain('.fluxaos-artifacts/');
  });
});
