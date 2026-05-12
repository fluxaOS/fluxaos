import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { buildGitRouter } from '@/adapters/git-router/validator-registry';

describe('GitRouter.validate (FLX-227)', () => {
  // Construct once at suite scope — buildGitRouter() throws if
  // FLUXAOS_GITHUB_TOKEN is missing. That's intentional (the rest of
  // the suite needs the same env anyway).
  const router = buildGitRouter();

  it('returns INVALID_URL for a malformed URL', async () => {
    const result = await router.validate('not a url');
    expect(result).toEqual({
      ok: false,
      provider: null,
      reason: 'INVALID_URL',
    });
  });

  it('returns UNSUPPORTED_HOST for a host with no registered validator', async () => {
    const result = await router.validate('https://bitbucket.org/owner/repo');
    expect(result).toEqual({
      ok: false,
      provider: null,
      reason: 'UNSUPPORTED_HOST',
    });
  });

  it('returns INVALID_URL for a GitHub URL that does not parse as owner/repo', async () => {
    const result = await router.validate('https://github.com/just-one-segment');
    expect(result).toEqual({
      ok: false,
      provider: 'github',
      reason: 'INVALID_URL',
    });
  });

  it('returns REPO_NOT_FOUND for a GitHub URL pointing at a non-existent repo', async () => {
    const result = await router.validate(
      'https://github.com/flux-not-a-real-org/flux-not-a-real-repo'
    );
    expect(result).toEqual({
      ok: false,
      provider: 'github',
      reason: 'REPO_NOT_FOUND',
    });
  });

  it('returns ok:true for a real public GitHub repo', async () => {
    const result = await router.validate('https://github.com/fluxaOS/fluxaos');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.provider).toBe('github');
      expect(result.coords).toEqual({ owner: 'fluxaOS', repo: 'fluxaos' });
    }
  });

  it('accepts a .git suffix on the URL', async () => {
    const result = await router.validate(
      'https://github.com/fluxaOS/fluxaos.git'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.coords).toEqual({ owner: 'fluxaOS', repo: 'fluxaos' });
    }
  });
});
