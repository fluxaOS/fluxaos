import type { GitOpsPort } from '@/core/ports/git';
import { resolveRepoIdentity } from './path-resolver';
import { branchAheadCount, commitAll, getHeadSha, push } from './worktree';

/**
 * Concrete implementation of the GitOpsPort backed by local git shell-outs.
 *
 * Constructed once at bootstrap and injected into core services via DI.
 * Keeps src/core/ free of direct adapter imports.
 */
export function createGitOps(): GitOpsPort {
  return {
    commitAll,
    getHeadSha,
    push,
    resolveRepoIdentity,
    branchAheadCount,
  };
}
