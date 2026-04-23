/**
 * Integration tests: src/adapters/git/worktree-copy.ts against real files.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  copyConfiguredFiles,
  copyWorktreeFile,
  isPathWithinRoot,
  parseCopyFileEntry,
} from '@/adapters/git/worktree-copy';

describe('parseCopyFileEntry', () => {
  it('returns identical source + destination', () => {
    expect(parseCopyFileEntry('.env')).toEqual({
      source: '.env',
      destination: '.env',
    });
  });
  it('trims whitespace', () => {
    expect(parseCopyFileEntry('  .env  ')).toEqual({
      source: '.env',
      destination: '.env',
    });
  });
  it('throws on empty', () => {
    expect(() => parseCopyFileEntry('')).toThrow();
    expect(() => parseCopyFileEntry('   ')).toThrow();
  });
});

describe('isPathWithinRoot', () => {
  it('allows relative paths inside root', () => {
    expect(isPathWithinRoot('/a/b', '.env')).toBe(true);
    expect(isPathWithinRoot('/a/b', 'data/fixtures')).toBe(true);
  });
  it('rejects path traversal via ../', () => {
    expect(isPathWithinRoot('/a/b', '../etc/passwd')).toBe(false);
    expect(isPathWithinRoot('/a/b', '../../x')).toBe(false);
  });
  it('joins absolute-looking entries as subpaths of root', () => {
    // path.join does NOT treat a leading '/' in the second arg as absolute;
    // the result is /a/b/etc/passwd, which IS within root. Effectively
    // an absolute entry gets re-rooted (benign: ENOENT on missing source).
    expect(isPathWithinRoot('/a/b', '/etc/passwd')).toBe(true);
  });
});

describe('copyWorktreeFile + copyConfiguredFiles', () => {
  let src: string;
  let dst: string;

  beforeEach(async () => {
    src = await mkdtemp(join(tmpdir(), 'fluxaos-copy-src-'));
    dst = await mkdtemp(join(tmpdir(), 'fluxaos-copy-dst-'));
  });

  afterEach(async () => {
    await rm(src, { recursive: true, force: true });
    await rm(dst, { recursive: true, force: true });
  });

  it('copies a single file', async () => {
    await writeFile(join(src, '.env'), 'KEY=value');
    const result = await copyWorktreeFile(src, dst, parseCopyFileEntry('.env'));
    expect(result.copied).toBe(true);
    const content = await readFile(join(dst, '.env'), 'utf-8');
    expect(content).toBe('KEY=value');
  });

  it('copies a directory recursively', async () => {
    await mkdir(join(src, 'fixtures'));
    await writeFile(join(src, 'fixtures', 'a.txt'), 'a');
    await writeFile(join(src, 'fixtures', 'b.txt'), 'b');
    const result = await copyWorktreeFile(
      src,
      dst,
      parseCopyFileEntry('fixtures')
    );
    expect(result.copied).toBe(true);
    await access(join(dst, 'fixtures', 'a.txt'));
    await access(join(dst, 'fixtures', 'b.txt'));
  });

  it('silently skips ENOENT', async () => {
    const result = await copyWorktreeFile(
      src,
      dst,
      parseCopyFileEntry('nonexistent.file')
    );
    expect(result.copied).toBe(false);
    expect(result.reason).toContain('does not exist');
  });

  it('rejects traversal attempts without copying', async () => {
    // Create the target "outside" file so ENOENT doesn't mask the traversal guard
    await writeFile(join(src, '..', 'outside.txt'), 'pwn').catch(() => {});
    const result = await copyWorktreeFile(
      src,
      dst,
      parseCopyFileEntry('../outside.txt')
    );
    expect(result.copied).toBe(false);
    expect(result.reason).toContain('path-traversal');
  });

  it('copyConfiguredFiles reports per-entry outcomes', async () => {
    await writeFile(join(src, '.env'), 'K=V');
    // missing.file intentionally not created
    const report = await copyConfiguredFiles(src, dst, [
      '.env',
      'missing.file',
      '../traverse.txt',
    ]);
    expect(report.entries).toHaveLength(3);
    expect(report.entries[0].copied).toBe(true);
    expect(report.entries[1].copied).toBe(false);
    expect(report.entries[1].reason).toContain('does not exist');
    expect(report.entries[2].copied).toBe(false);
    expect(report.entries[2].reason).toContain('path-traversal');
  });
});
