/**
 * Integration tests: src/adapters/git/artifacts-path.ts against real filesystem.
 *
 * Mirrors path-resolver.test.ts. Uses real tmpdirs for repoPath resolution.
 * Config overrides are passed as parameters — no process.env manipulation needed.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getArtifactsBase,
  getArtifactsPath,
} from '@/adapters/git/artifacts-path';

describe('getArtifactsBase + getArtifactsPath against real tmpdirs', () => {
  let repoPath: string;

  beforeEach(async () => {
    repoPath = await mkdtemp(join(tmpdir(), 'fluxaos-artifacts-path-'));
  });

  afterEach(async () => {
    await rm(repoPath, { recursive: true, force: true });
  });

  it('puts artifacts inside the repo by default', () => {
    const base = getArtifactsBase(repoPath);
    expect(base).toBe(join(repoPath, '.fluxaos-artifacts'));
  });

  it('uses artifactsRoot when set to an absolute path', () => {
    expect(
      getArtifactsBase(repoPath, { artifactsRoot: '/srv/flux/artifacts' })
    ).toBe('/srv/flux/artifacts');
  });

  it('throws when artifactsRoot is relative', () => {
    expect(() =>
      getArtifactsBase(repoPath, { artifactsRoot: 'relative/path' })
    ).toThrow(/FLUXAOS_ARTIFACTS_ROOT must be an absolute path/);
  });

  it('falls back to workspaceRoot when artifactsRoot is unset', () => {
    expect(
      getArtifactsBase(repoPath, { workspaceRoot: '/srv/flux/workspaces' })
    ).toBe('/srv/flux/workspaces');
  });

  it('prefers artifactsRoot over workspaceRoot when both set', () => {
    expect(
      getArtifactsBase(repoPath, {
        artifactsRoot: '/srv/flux/artifacts',
        workspaceRoot: '/srv/flux/workspaces',
      })
    ).toBe('/srv/flux/artifacts');
  });

  it('getArtifactsPath composes base + runId with no double-slashes', () => {
    const runId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const path = getArtifactsPath(repoPath, runId);
    expect(path).toBe(join(repoPath, '.fluxaos-artifacts', runId));
    // Defensive: ensure no accidental '//' collision anywhere on the path.
    expect(path).not.toMatch(/\/\//);
    // Defensive: ensure the runId segment isn't promoted to root.
    expect(path.startsWith(`/${runId}`)).toBe(false);
  });
});
