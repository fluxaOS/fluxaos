/**
 * GitHub implementation of the `GitProvider` port.
 *
 * Alpha scope (R-RUNTIME): only `createBranch` and `createPullRequest` are
 * implemented. The remaining three port methods (`getPullRequest`,
 * `listPullRequests`, `mergePullRequest`) are stubbed with
 * `NotImplementedError` — they land post-alpha, per
 * docs/superpowers/roadmap.md.
 *
 * All Octokit failures surface as `GitHubOperationError` with the HTTP
 * status + method/endpoint + original cause attached, so downstream
 * orchestrator code can branch on status without reaching into Octokit
 * internals. The one fast-path exception is the 422 "ref already exists"
 * response from `createBranch`, which surfaces as the narrower
 * `GitHubBranchExistsError`.
 */

import { RequestError } from '@octokit/request-error';
import type { Octokit } from '@octokit/rest';
import type {
  CreatePRParams,
  GitProvider,
  PullRequest,
} from '@/core/ports/git';
import { getAuthenticatedOctokit } from './auth';
import type { PullsCreateResponseData, RepoGetResponseData } from './types';

/** Thrown when a GitProvider method is called that isn't wired for alpha. */
export class NotImplementedError extends Error {
  constructor(methodName: string) {
    super(
      `GitHubAdapter.${methodName} is not implemented in alpha ` +
        `(R-RUNTIME scope). See docs/superpowers/roadmap.md Post-Alpha.`
    );
    this.name = 'NotImplementedError';
  }
}

/** Thrown when `createBranch` finds the ref already exists on the remote. */
export class GitHubBranchExistsError extends Error {
  constructor(
    public readonly repo: string,
    public readonly branch: string
  ) {
    super(`Branch '${branch}' already exists on ${repo}.`);
    this.name = 'GitHubBranchExistsError';
  }
}

/** Generic wrapper for any other Octokit RequestError. */
export class GitHubOperationError extends Error {
  public readonly status: number;
  public readonly method: string;
  public readonly endpoint: string;
  public readonly cause: RequestError;

  constructor(args: {
    status: number;
    method: string;
    endpoint: string;
    message: string;
    cause: RequestError;
  }) {
    super(args.message);
    this.name = 'GitHubOperationError';
    this.status = args.status;
    this.method = args.method;
    this.endpoint = args.endpoint;
    this.cause = args.cause;
  }
}

function parseRepo(repo: string): { owner: string; name: string } {
  const parts = repo.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid repo identifier '${repo}'. Expected format 'owner/name'.`
    );
  }
  return { owner: parts[0], name: parts[1] };
}

function wrapOctokitError(err: unknown): never {
  if (err instanceof RequestError) {
    throw new GitHubOperationError({
      status: err.status,
      method: err.request.method,
      endpoint: err.request.url,
      message: err.message,
      cause: err,
    });
  }
  throw err;
}

function mapPullRequest(data: PullsCreateResponseData): PullRequest {
  const state: PullRequest['state'] = data.merged_at
    ? 'merged'
    : (data.state as 'open' | 'closed');
  return {
    number: data.number,
    title: data.title,
    body: data.body ?? '',
    state,
    headBranch: data.head.ref,
    baseBranch: data.base.ref,
    url: data.html_url,
    createdAt: new Date(data.created_at),
  };
}

export interface CreateGitHubAdapterDeps {
  /**
   * Optional Octokit instance. When omitted, the adapter constructs one via
   * `getAuthenticatedOctokit()` at factory-call time (not module load), so
   * importing this module stays side-effect free.
   */
  octokit?: Octokit;
}

export function createGitHubAdapter(
  deps: CreateGitHubAdapterDeps = {}
): GitProvider {
  const octokit = deps.octokit ?? getAuthenticatedOctokit();

  async function createBranch(
    repo: string,
    branch: string,
    fromRef?: string
  ): Promise<void> {
    const { owner, name } = parseRepo(repo);

    let baseRef = fromRef;
    if (!baseRef) {
      try {
        const repoResp = await octokit.rest.repos.get({ owner, repo: name });
        const repoData: RepoGetResponseData = repoResp.data;
        baseRef = repoData.default_branch;
      } catch (err) {
        wrapOctokitError(err);
      }
    }

    // Resolve the base ref to a SHA.
    let sha: string;
    try {
      const refResp = await octokit.rest.git.getRef({
        owner,
        repo: name,
        ref: `heads/${baseRef}`,
      });
      sha = refResp.data.object.sha;
    } catch (err) {
      wrapOctokitError(err);
    }

    try {
      await octokit.rest.git.createRef({
        owner,
        repo: name,
        ref: `refs/heads/${branch}`,
        sha: sha!,
      });
    } catch (err) {
      if (err instanceof RequestError && err.status === 422) {
        throw new GitHubBranchExistsError(repo, branch);
      }
      wrapOctokitError(err);
    }
  }

  async function createPullRequest(
    params: CreatePRParams
  ): Promise<PullRequest> {
    const { owner, name } = parseRepo(params.repo);
    try {
      const resp = await octokit.rest.pulls.create({
        owner,
        repo: name,
        title: params.title,
        body: params.body,
        head: params.headBranch,
        base: params.baseBranch,
        draft: params.draft ?? false,
      });
      return mapPullRequest(resp.data);
    } catch (err) {
      wrapOctokitError(err);
    }
  }

  async function getPullRequest(): Promise<PullRequest> {
    throw new NotImplementedError('getPullRequest');
  }

  async function listPullRequests(): Promise<PullRequest[]> {
    throw new NotImplementedError('listPullRequests');
  }

  async function mergePullRequest(): Promise<void> {
    throw new NotImplementedError('mergePullRequest');
  }

  return {
    createBranch,
    createPullRequest,
    getPullRequest,
    listPullRequests,
    mergePullRequest,
  };
}
