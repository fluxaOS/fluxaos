/**
 * Path resolution for worktree-per-run workspaces.
 *
 * Shape borrowed from Archon's resolveOwnerRepo + getWorktreeBase patterns
 * (MIT, packages/git/src/worktree.ts). fluxaOS default is in-project
 * `.fluxaos-worktrees/` for NFS/Docker friendliness; Archon's workspace-scoped
 * layout is the opt-in alternative via FLUXAOS_WORKSPACE_ROOT.
 */

import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export interface RepoIdentity {
  owner: string;
  repo: string;
}

export interface ResolveRepoIdentityInput {
  repoPath?: string;
  repoUrl?: string;
  override?: string;
}

const REPO_URL_PATTERNS: RegExp[] = [
  /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/i,
  /gitlab\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/i,
  /bitbucket\.org[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/i,
  /[/:]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/,
];

/**
 * Resolve the owner/repo identity for a project. Precedence:
 *   1. Explicit override in `owner/repo` format
 *   2. repoUrl parsed via known forge patterns
 *   3. Last-two-path-segments fallback from repoPath
 *
 * Throws if nothing yields an identity — callers must provide at least one
 * resolvable input.
 */
export function resolveRepoIdentity(
  input: ResolveRepoIdentityInput
): RepoIdentity {
  const { repoPath, repoUrl, override } = input;

  if (override) {
    const parts = override.split('/');
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { owner: parts[0], repo: parts[1] };
    }
    throw new Error(
      `Invalid override '${override}'. Expected 'owner/repo' format.`
    );
  }

  if (repoUrl) {
    for (const pattern of REPO_URL_PATTERNS) {
      const match = repoUrl.match(pattern);
      if (match?.[1] && match[2]) {
        return { owner: match[1], repo: match[2] };
      }
    }
  }

  if (repoPath) {
    const normalized = resolve(repoPath);
    const parent = basename(dirname(normalized));
    const last = basename(normalized);
    if (parent && last) {
      return { owner: parent, repo: last };
    }
  }

  throw new Error(
    'Could not resolve repo identity. Provide override, repoUrl, or repoPath.'
  );
}

/**
 * Root for worktree storage. Default: in-project `.fluxaos-worktrees/`.
 *
 * Accepts an explicit override (injected from FluxaosConfig.workspaceRoot).
 * When override is undefined, returns null — each repo gets its own
 * in-project dir via getWorktreeBase.
 *
 * Throws if the override value is not an absolute path.
 */
export function getWorkspaceRoot(override?: string | undefined): string | null {
  if (!override) return null;
  if (!isAbsolute(override)) {
    throw new Error(
      `FLUXAOS_WORKSPACE_ROOT must be an absolute path, got '${override}'.`
    );
  }
  return override;
}

/**
 * Derive the base directory under which a repo's worktrees live.
 *
 * If workspaceRoot is provided (absolute):
 *   <workspaceRoot>/<owner>/<repo>/worktrees/
 *
 * Otherwise (default, in-project layout):
 *   <repoPath>/.fluxaos-worktrees/
 */
export function getWorktreeBase(params: {
  repoPath: string;
  repoIdentity: RepoIdentity;
  workspaceRoot?: string | undefined;
}): string {
  const override = getWorkspaceRoot(params.workspaceRoot);
  if (override) {
    return join(
      override,
      params.repoIdentity.owner,
      params.repoIdentity.repo,
      'worktrees'
    );
  }
  return join(resolve(params.repoPath), '.fluxaos-worktrees');
}

/**
 * Compose the full worktree path for a specific branch.
 * Branch names may contain '/'; we replace with '__' for a safe directory name.
 */
export function getWorktreePath(params: {
  repoPath: string;
  repoIdentity: RepoIdentity;
  branchName: string;
  workspaceRoot?: string | undefined;
}): string {
  const safeBranchDir = params.branchName.replace(/\//g, '__');
  return join(
    getWorktreeBase({
      repoPath: params.repoPath,
      repoIdentity: params.repoIdentity,
      workspaceRoot: params.workspaceRoot,
    }),
    safeBranchDir
  );
}

/**
 * Default home-based workspace root — used only when an operator wants to
 * point FLUXAOS_WORKSPACE_ROOT at `~/.fluxaos/workspaces` specifically.
 * Exported as a helper; not consumed unless the env var references it.
 */
export function getDefaultHomeWorkspaceRoot(): string {
  return join(homedir(), '.fluxaos', 'workspaces');
}
