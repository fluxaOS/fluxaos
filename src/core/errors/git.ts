/**
 * Core git errors — domain-level error types for git operations.
 *
 * Defined in core so orchestrator and deploy-bridge can catch them without
 * importing from src/adapters/. The git adapter re-exports this class for
 * backward-compat.
 */

export class UncommittedChangesError extends Error {
  constructor(envId: string, workingPath: string) {
    super(
      `Cannot release env ${envId}: uncommitted changes at ${workingPath}. ` +
        `Pass { force: true } to override.`
    );
    this.name = 'UncommittedChangesError';
  }
}

/**
 * FLX-218 — thrown by GitProviderFactory.forUrl when a project's repoUrl
 * points at a host the router can't route. Previously the router silently
 * fell back to the GitHub adapter for any unrecognized hostname, which
 * masked misconfiguration. Fail fast instead.
 *
 * Companion fix FLX-227 adds a save-time guard on the project form so
 * operators see the same contract before the URL ever reaches the runtime.
 */
export const SUPPORTED_GIT_HOSTS = [
  'github',
  'gitlab',
  'forgejo / codeberg',
  'gitea',
] as const;

export class UnsupportedGitHostError extends Error {
  readonly repoUrl: string;

  constructor(repoUrl: string) {
    super(
      `Unsupported git host for repoUrl ${JSON.stringify(repoUrl)}. ` +
        `Supported hosts: ${SUPPORTED_GIT_HOSTS.join(', ')}. ` +
        `Set the project's repoUrl to a fully-qualified URL on a supported host.`
    );
    this.name = 'UnsupportedGitHostError';
    this.repoUrl = repoUrl;
  }
}
