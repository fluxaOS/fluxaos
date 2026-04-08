import { afterAll, describe, expect, it } from 'vitest';
import {
  createIssue,
  getIssue,
  listIssues,
  transitionIssue,
  updateIssue,
} from '@/core/issues';
import { cleanup, SEED_PROJECT_ID } from './setup';

const issueIds: string[] = [];

afterAll(async () => {
  await cleanup({ issueIds });
});

describe('issues integration', () => {
  let createdId: string;

  it('creates an issue in the real database', async () => {
    const issue = await createIssue({
      projectId: SEED_PROJECT_ID,
      title: 'Integration test issue',
      priority: 'high',
      type: 'bug',
    });

    expect(issue.id).toBeDefined();
    expect(issue.title).toBe('Integration test issue');
    expect(issue.state).toBe('open');
    expect(issue.priority).toBe('high');
    createdId = issue.id;
    issueIds.push(issue.id);
  });

  it('retrieves the issue by id with events', async () => {
    const issue = await getIssue(createdId);
    expect(issue.id).toBe(createdId);
    expect(issue.title).toBe('Integration test issue');
    expect(issue.events).toBeDefined();
    expect(issue.events.length).toBeGreaterThanOrEqual(1);
    expect(issue.events[0].type).toBe('created');
  });

  it('lists issues for the project', async () => {
    const issues = await listIssues(SEED_PROJECT_ID);
    const found = issues.find((i) => i.id === createdId);
    expect(found).toBeDefined();
  });

  it('updates the issue', async () => {
    const updated = await updateIssue(createdId, {
      title: 'Updated integration test issue',
    });
    expect(updated.title).toBe('Updated integration test issue');
  });

  it('transitions the issue state', async () => {
    const transitioned = await transitionIssue(createdId, 'in_progress');
    expect(transitioned.state).toBe('in_progress');
  });

  it('rejects invalid state transitions', async () => {
    await expect(transitionIssue(createdId, 'open')).resolves.toBeDefined();
    // Test: closed cannot go to in_progress
    await transitionIssue(createdId, 'closed');
    await expect(transitionIssue(createdId, 'in_progress')).rejects.toThrow(
      'Invalid transition'
    );
  });
});
