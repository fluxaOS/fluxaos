import type {
  CreatePRParams,
  GitProvider,
  PullRequest,
} from '@/core/ports/git';

interface GitHubPRResponse {
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged: boolean;
  head: { ref: string };
  base: { ref: string };
  html_url: string;
  created_at: string;
}

interface GitHubRefResponse {
  ref: string;
  object: { sha: string };
}

function toPullRequest(gh: GitHubPRResponse): PullRequest {
  let state: 'open' | 'closed' | 'merged' = 'open';
  if (gh.merged) state = 'merged';
  else if (gh.state === 'closed') state = 'closed';

  return {
    number: gh.number,
    title: gh.title,
    body: gh.body ?? '',
    state,
    headBranch: gh.head.ref,
    baseBranch: gh.base.ref,
    url: gh.html_url,
    createdAt: new Date(gh.created_at),
  };
}

export class GitHubGitProvider implements GitProvider {
  private baseUrl = 'https://api.github.com';
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(), ...init?.headers },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub API error ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  async createBranch(
    repo: string,
    branch: string,
    fromRef?: string
  ): Promise<void> {
    // Get SHA of the source ref (default: HEAD of default branch)
    const sourceRef = fromRef ?? 'heads/main';
    const ref = await this.request<GitHubRefResponse>(
      `/repos/${repo}/git/ref/${sourceRef}`
    );

    await this.request(`/repos/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: ref.object.sha,
      }),
    });
  }

  async createPullRequest(params: CreatePRParams): Promise<PullRequest> {
    const gh = await this.request<GitHubPRResponse>(
      `/repos/${params.repo}/pulls`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: params.title,
          body: params.body,
          head: params.headBranch,
          base: params.baseBranch,
          draft: params.draft ?? false,
        }),
      }
    );
    return toPullRequest(gh);
  }

  async getPullRequest(repo: string, number: number): Promise<PullRequest> {
    const gh = await this.request<GitHubPRResponse>(
      `/repos/${repo}/pulls/${number}`
    );
    return toPullRequest(gh);
  }

  async listPullRequests(
    repo: string,
    state?: 'open' | 'closed' | 'all'
  ): Promise<PullRequest[]> {
    const qs = state ? `?state=${state}` : '';
    const ghs = await this.request<GitHubPRResponse[]>(
      `/repos/${repo}/pulls${qs}`
    );
    return ghs.map(toPullRequest);
  }

  async mergePullRequest(
    repo: string,
    number: number,
    method?: 'merge' | 'squash' | 'rebase'
  ): Promise<void> {
    await this.request(`/repos/${repo}/pulls/${number}/merge`, {
      method: 'PUT',
      body: JSON.stringify({
        merge_method: method ?? 'squash',
      }),
    });
  }
}
