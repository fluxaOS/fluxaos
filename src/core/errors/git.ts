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
