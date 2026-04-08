import { registry } from '@/config/registry';
import { GitHubIssueProvider } from './issues';

registry.register(
  'issue',
  'github',
  () =>
    new GitHubIssueProvider({
      token: process.env.GITHUB_TOKEN ?? '',
    })
);
