/**
 * Integration tests: src/adapters/git/artifacts-path.ts against real filesystem.
 *
 * Mirrors path-resolver.test.ts. Uses real tmpdirs for repoPath resolution.
 * Restores process.env between tests so env-var assertions don't leak.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getArtifactsBase,
  getArtifactsPath,
} from '@/adapters/git/artifacts-path';

describe('getArtifactsBase + getArtifactsPath against real tmpdirs', () => {
  let repoPath: string;
  const originalArtifactsRoot = process.env.FLUXAOS_ARTIFACTS_ROOT;
  const originalWorkspaceRoot = process.env.FLUXAOS_WORKSPACE_ROOT;

  beforeEach(async () => {
    repoPath = await mkdtemp(join(tmpdir(), 'fluxaos-artifacts-path-'));
    delete process.env.FLUXAOS_ARTIFACTS_ROOT;
    delete process.env.FLUXAOS_WORKSPACE_ROOT;
  });

  afterEach(async () => {
    if (originalArtifactsRoot === undefined) {
      delete process.env.FLUXAOS_ARTIFACTS_ROOT;
    } else {
      process.env.FLUXAOS_ARTIFACTS_ROOT = originalArtifactsRoot;
    }
    if (originalWorkspaceRoot === undefined) {
      delete process.env.FLUXAOS_WORKSPACE_ROOT;
    } else {
      process.env.FLUXAOS_WORKSPACE_ROOT = originalWorkspaceRoot;
    }
    await rm(repoPath, { recursive: true, force: true });
  });

  it('puts artifacts inside the repo by default', () => {
    const base = getArtifactsBase(repoPath);
    expect(base).toBe(join(repoPath, '.fluxaos-artifacts'));
  });

  it('uses FLUXAOS_ARTIFACTS_ROOT when set to an absolute path', () => {
    process.env.FLUXAOS_ARTIFACTS_ROOT = '/srv/flux/artifacts';
    expect(getArtifactsBase(repoPath)).toBe('/srv/flux/artifacts');
  });

  it('throws when FLUXAOS_ARTIFACTS_ROOT is relative', () => {
    process.env.FLUXAOS_ARTIFACTS_ROOT = 'relative/path';
    expect(() => getArtifactsBase(repoPath)).toThrow(
      /FLUXAOS_ARTIFACTS_ROOT must be an absolute path/
    );
  });

  it('falls back to FLUXAOS_WORKSPACE_ROOT when ARTIFACTS_ROOT is unset', () => {
    process.env.FLUXAOS_WORKSPACE_ROOT = '/srv/flux/workspaces';
    expect(getArtifactsBase(repoPath)).toBe('/srv/flux/workspaces');
  });

  it('prefers FLUXAOS_ARTIFACTS_ROOT over FLUXAOS_WORKSPACE_ROOT when both set', () => {
    process.env.FLUXAOS_ARTIFACTS_ROOT = '/srv/flux/artifacts';
    process.env.FLUXAOS_WORKSPACE_ROOT = '/srv/flux/workspaces';
    expect(getArtifactsBase(repoPath)).toBe('/srv/flux/artifacts');
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
