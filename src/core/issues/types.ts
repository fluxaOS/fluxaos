export type IssueState = 'open' | 'in_progress' | 'blocked' | 'closed';
export type IssuePriority = 'low' | 'medium' | 'high' | 'critical';
export type IssueType = 'task' | 'bug' | 'feature' | 'research';

export interface CreateIssueInput {
  projectId: string;
  title: string;
  description?: string;
  priority?: IssuePriority;
  type?: IssueType;
  createdBy?: string;
  source?: string;
}

export interface UpdateIssueInput {
  title?: string;
  description?: string;
  priority?: IssuePriority;
  type?: IssueType;
}

export const VALID_TRANSITIONS: Record<IssueState, IssueState[]> = {
  open: ['in_progress', 'blocked', 'closed'],
  in_progress: ['open', 'blocked', 'closed'],
  blocked: ['open', 'in_progress'],
  closed: ['open'],
};
