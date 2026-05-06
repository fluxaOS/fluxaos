// ── Local git operations ──────────────────────────────────────────────────────

export interface CommitAllResult {
  commitSha?: string;
  noChanges?: true;
}

export interface RepoIdentity {
  owner: string;
  repo: string;
}

export interface ResolveRepoIdentityInput {
  repoPath?: string;
  repoUrl?: string;
  override?: string;
}

/**
 * GitOpsPort — local git operations (filesystem-level).
 *
 * Distinct from GitProvider (remote forge operations). Injected into core
 * services so src/core/ never imports from src/adapters/git directly.
 */
export interface GitOpsPort {
  commitAll(worktreePath: string, message: string): Promise<CommitAllResult>;
  getHeadSha(worktreePath: string): Promise<string>;
  push(
    worktreePath: string,
    branchName: string,
    options?: { setUpstream?: boolean }
  ): Promise<void>;
  resolveRepoIdentity(input: ResolveRepoIdentityInput): RepoIdentity;
  branchAheadCount(worktreePath: string, baseRef: string): Promise<number>;
}

// ── Remote git operations ─────────────────────────────────────────────────────

export interface CreatePRParams {
  repo: string;
  title: string;
  body: string;
  headBranch: string;
  baseBranch: string;
  draft?: boolean;
}

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  headBranch: string;
  baseBranch: string;
  url: string;
  createdAt: Date;
}

export interface GitProvider {
  /** Returns the provider's canonical name (e.g. `'github'`). */
  providerName(): string;

  createBranch(repo: string, branch: string, fromRef?: string): Promise<void>;

  createPullRequest(params: CreatePRParams): Promise<PullRequest>;

  getPullRequest(repo: string, number: number): Promise<PullRequest>;

  listPullRequests(
    repo: string,
    state?: 'open' | 'closed' | 'all'
  ): Promise<PullRequest[]>;

  mergePullRequest(
    repo: string,
    number: number,
    method?: 'merge' | 'squash' | 'rebase'
  ): Promise<void>;
}
