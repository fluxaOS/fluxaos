import { registry } from '@/config/registry';
import { GitHubGitProvider } from './git';
import { GitHubIssueProvider } from './issues';

registry.register(
  'issue',
  'github',
  () =>
    new GitHubIssueProvider({
      token: process.env.GITHUB_TOKEN ?? '',
    })
);

registry.register(
  'git',
  'github',
  () => new GitHubGitProvider(process.env.GITHUB_TOKEN ?? '')
);
