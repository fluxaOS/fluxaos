import { describe, expect, it, vi } from 'vitest';

// Mock the DB before importing the module
vi.mock('@/core/db', () => ({
  db: {
    query: {
      issue: {
        findFirst: vi.fn(),
      },
    },
  },
}));

import { db } from '@/core/db';
import { assemblePrompt } from '@/core/pipeline/prompt-assembler';

describe('assemblePrompt', () => {
  it('includes persona soul when provided', async () => {
    const result = await assemblePrompt({
      issueId: null,
      personaSoul: 'You are a careful reviewer.',
      stageName: 'review',
      skillsDir: null,
    });

    expect(result).toContain('## Persona');
    expect(result).toContain('You are a careful reviewer.');
  });

  it('always includes stage context', async () => {
    const result = await assemblePrompt({
      issueId: null,
      personaSoul: null,
      stageName: 'implement',
      skillsDir: null,
    });

    expect(result).toContain('## Stage: implement');
    expect(result).toContain(
      'You are executing the "implement" stage of a pipeline.'
    );
  });

  it('omits persona section when soul is null', async () => {
    const result = await assemblePrompt({
      issueId: null,
      personaSoul: null,
      stageName: 'deploy',
      skillsDir: null,
    });

    expect(result).not.toContain('## Persona');
  });

  it('includes issue context when issue is found', async () => {
    const mockFindFirst = vi.mocked(db.query.issue.findFirst);
    mockFindFirst.mockResolvedValueOnce({
      id: 'issue-1',
      title: 'Fix login bug',
      description: 'Users cannot log in after password reset.',
      externalId: null,
      externalUrl: null,
      projectId: 'proj-1',
      status: 'open',
      priority: 'high',
      labels: [],
      assignee: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);

    const result = await assemblePrompt({
      issueId: 'issue-1',
      personaSoul: null,
      stageName: 'implement',
      skillsDir: null,
    });

    expect(result).toContain('## Task');
    expect(result).toContain('Fix login bug');
    expect(result).toContain('Users cannot log in after password reset.');
  });

  it('continues without issue when lookup fails', async () => {
    const mockFindFirst = vi.mocked(db.query.issue.findFirst);
    mockFindFirst.mockRejectedValueOnce(new Error('DB error'));

    const result = await assemblePrompt({
      issueId: 'bad-id',
      personaSoul: null,
      stageName: 'research',
      skillsDir: null,
    });

    expect(result).toContain('## Stage: research');
    expect(result).not.toContain('## Task');
  });

  it('separates sections with horizontal rules', async () => {
    const result = await assemblePrompt({
      issueId: null,
      personaSoul: 'Be thorough.',
      stageName: 'review',
      skillsDir: null,
    });

    expect(result).toContain('---');
    const parts = result.split('\n\n---\n\n');
    expect(parts.length).toBe(2);
  });
});
