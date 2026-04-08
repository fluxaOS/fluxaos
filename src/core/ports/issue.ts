export interface CreateIssueParams {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

export interface ExternalIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  url: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IssueProvider {
  createIssue(repo: string, issue: CreateIssueParams): Promise<ExternalIssue>;

  updateIssue(
    repo: string,
    number: number,
    updates: Partial<CreateIssueParams>
  ): Promise<ExternalIssue>;

  getIssue(repo: string, number: number): Promise<ExternalIssue>;

  listIssues(
    repo: string,
    state?: 'open' | 'closed' | 'all'
  ): Promise<ExternalIssue[]>;

  syncFromExternal(repo: string, since?: Date): Promise<ExternalIssue[]>;
}
