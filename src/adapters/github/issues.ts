import type {
  CreateIssueParams,
  ExternalIssue,
  IssueProvider,
} from '@/core/ports/issue';

interface GitHubIssueResponse {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: Array<{ name: string }>;
  html_url: string;
  created_at: string;
  updated_at: string;
}

function toExternalIssue(gh: GitHubIssueResponse): ExternalIssue {
  return {
    number: gh.number,
    title: gh.title,
    body: gh.body ?? '',
    state: gh.state as 'open' | 'closed',
    labels: gh.labels.map((l) => l.name),
    url: gh.html_url,
    createdAt: new Date(gh.created_at),
    updatedAt: new Date(gh.updated_at),
  };
}

export class GitHubIssueProvider implements IssueProvider {
  private baseUrl = 'https://api.github.com';
  private token: string;

  constructor({ token }: { token: string }) {
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

  async createIssue(
    repo: string,
    params: CreateIssueParams
  ): Promise<ExternalIssue> {
    const gh = await this.request<GitHubIssueResponse>(
      `/repos/${repo}/issues`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: params.title,
          body: params.body,
          labels: params.labels,
          assignees: params.assignees,
        }),
      }
    );
    return toExternalIssue(gh);
  }

  async updateIssue(
    repo: string,
    number: number,
    updates: Partial<CreateIssueParams>
  ): Promise<ExternalIssue> {
    const gh = await this.request<GitHubIssueResponse>(
      `/repos/${repo}/issues/${number}`,
      {
        method: 'PATCH',
        body: JSON.stringify(updates),
      }
    );
    return toExternalIssue(gh);
  }

  async getIssue(repo: string, number: number): Promise<ExternalIssue> {
    const gh = await this.request<GitHubIssueResponse>(
      `/repos/${repo}/issues/${number}`
    );
    return toExternalIssue(gh);
  }

  async listIssues(
    repo: string,
    state?: 'open' | 'closed' | 'all'
  ): Promise<ExternalIssue[]> {
    const qs = state ? `?state=${state}` : '';
    const ghs = await this.request<GitHubIssueResponse[]>(
      `/repos/${repo}/issues${qs}`
    );
    return ghs.map(toExternalIssue);
  }

  async syncFromExternal(repo: string, since?: Date): Promise<ExternalIssue[]> {
    const params = new URLSearchParams({ state: 'all' });
    if (since) {
      params.set('since', since.toISOString());
    }
    const ghs = await this.request<GitHubIssueResponse[]>(
      `/repos/${repo}/issues?${params.toString()}`
    );
    return ghs.map(toExternalIssue);
  }
}
