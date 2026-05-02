import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { createIssueService } from '@/core/services/issue';
import { createIssueCommentService } from '@/core/services/issue-comment';
import { executePaperwork } from '@/core/pipeline/paperwork-executor';
import type { AuditResult } from '@/core/pipeline/playbook-auditor';
import { issue } from '@/core/db/schema';

// Real DB integration — requires DIRECT_URL or DATABASE_URL in env
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const skip = !url;

const dbProvider = skip ? null : new SupabaseDatabaseProvider(url!);
const db = dbProvider?.getConnection();

describe.skipIf(skip)('executePaperwork (real DB)', () => {
  let testIssueId: string;
  let testProjectId: string;

  beforeAll(async () => {
    if (!db) return;
    const [row] = await db.select({ id: issue.id, projectId: issue.projectId }).from(issue).limit(1);
    if (!row) throw new Error('No issues in DB — run db:seed first');
    testIssueId = row.id;
    testProjectId = row.projectId;
  });

  afterAll(async () => {
    await dbProvider?.close?.();
  });

  it('posts comment when audit has comment', async () => {
    if (!db) return;
    const commentService = createIssueCommentService(db);

    const audit: AuditResult = {
      action: 'transition',
      targetState: 'research',
      comment: 'Paperwork executor integration test comment.',
    };

    await executePaperwork({
      issueId: testIssueId,
      projectId: testProjectId,
      db,
      audit,
    });

    const comments = await commentService.list(testIssueId);
    const testComment = comments.find(c => c.bodyMd?.includes('Paperwork executor integration test comment.'));
    expect(testComment).toBeDefined();
  });

  it('posts blocker summary comment when blockers present', async () => {
    if (!db) return;
    const commentService = createIssueCommentService(db);

    const audit: AuditResult = {
      action: 'fallback',
      targetState: 'blocked',
      blockers: [
        { title: 'CI broken', description: 'Tests are red on main.' },
        { title: 'Missing dep', description: 'Package not found.' },
      ],
    };

    await executePaperwork({
      issueId: testIssueId,
      projectId: testProjectId,
      db,
      audit,
    });

    const comments = await commentService.list(testIssueId);
    const blockerComment = comments.find(c => c.bodyMd?.includes('Stage flagged 2 blocker(s)'));
    expect(blockerComment).toBeDefined();
  });
});
