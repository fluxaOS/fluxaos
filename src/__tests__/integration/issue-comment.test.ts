/**
 * Integration tests: issue-comment service transactional atomicity.
 *
 * Covers Task 7 of R-REM-W2: softDelete must be atomic — a version-mismatch
 * failure must roll back the event insert that precedes the body-clear update.
 *
 * Self-contained: seeds its own org/user/project/catalogs/issue via real
 * services + DB. Does not depend on services.test.ts state.
 */
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import {
  createIssueCatalogService,
  createIssueCommentService,
  createIssueService,
  createOrganizationService,
  createProjectService,
  createUserService,
} from '@/core/services';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

const RUN = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

// Track cleanup actions; run in reverse order
const cleanup: Array<() => Promise<void>> = [];

// Shared test fixtures
let projectId: string;
let typeId: string;
let priorityId: string;

// Per-test seeded issues (separate so the two tests don't interfere)
let issueAId: string;
let issueBId: string;

beforeAll(async () => {
  const orgSvc = createOrganizationService(db);
  const userSvc = createUserService(db);
  const projSvc = createProjectService(db);
  const catalogSvc = createIssueCatalogService(db);
  const issueSvc = createIssueService(db);

  const org = await orgSvc.create({
    name: 'ICTest Org',
    slug: `ictest-org-${RUN}`,
    settings: {},
  });
  cleanup.push(async () => {
    await db
      .delete(schema.organization)
      .where(eq(schema.organization.id, org.id));
  });

  const usr = await userSvc.create({
    orgId: org.id,
    email: `ictest-${RUN}@example.com`,
    name: 'IC Test User',
    slug: `ictest-user-${RUN}`,
  });
  cleanup.push(async () => {
    await db.delete(schema.user).where(eq(schema.user.id, usr.id));
  });

  const proj = await projSvc.create({
    orgId: org.id,
    userId: usr.id,
    name: 'IC Test Project',
    slug: `ictest-proj-${RUN}`,
  });
  cleanup.push(async () => {
    await db.delete(schema.project).where(eq(schema.project.id, proj.id));
  });
  projectId = proj.id;

  const t = await catalogSvc.types.create({
    projectId,
    key: `feat-${RUN}`,
    displayName: 'Feature',
    color: '#0000ff',
    sortOrder: 1,
  });
  cleanup.push(async () => {
    await db.delete(schema.issueType).where(eq(schema.issueType.id, t.id));
  });
  typeId = t.id;

  const open = await catalogSvc.states.create({
    projectId,
    key: `open-${RUN}`,
    displayName: 'Open',
    color: '#22cc22',
    sortOrder: 1,
    isTerminal: false,
  });
  cleanup.push(async () => {
    await db.delete(schema.issueState).where(eq(schema.issueState.id, open.id));
  });

  const status = await catalogSvc.statuses.create({
    projectId,
    key: `backlog-${RUN}`,
    displayName: 'Backlog',
    sortOrder: 1,
  });
  cleanup.push(async () => {
    await db
      .delete(schema.issueStatus)
      .where(eq(schema.issueStatus.id, status.id));
  });

  const priority = await catalogSvc.priorities.create({
    projectId,
    key: `high-${RUN}`,
    displayName: 'High',
    color: '#ff0000',
    weight: 100,
  });
  cleanup.push(async () => {
    await db
      .delete(schema.issuePriority)
      .where(eq(schema.issuePriority.id, priority.id));
  });
  priorityId = priority.id;

  const [config] = await db
    .insert(schema.configEntry)
    .values({
      scope: 'project',
      projectId,
      key: 'issues.status.on_create_key',
      value: `backlog-${RUN}`,
    })
    .returning();
  cleanup.push(async () => {
    await db
      .delete(schema.configEntry)
      .where(eq(schema.configEntry.id, config.id));
  });

  // Seed two independent issues — one per test
  const issueA = await issueSvc.create({
    projectId,
    title: 'Issue A (rollback test)',
    typeId,
    priorityId,
    author: 'ictest-user',
  });
  cleanup.push(async () => {
    await db.delete(schema.issue).where(eq(schema.issue.id, issueA.id));
  });
  issueAId = issueA.id;

  const issueB = await issueSvc.create({
    projectId,
    title: 'Issue B (happy path)',
    typeId,
    priorityId,
    author: 'ictest-user',
  });
  cleanup.push(async () => {
    await db.delete(schema.issue).where(eq(schema.issue.id, issueB.id));
  });
  issueBId = issueB.id;
});

afterAll(async () => {
  for (const fn of cleanup.reverse()) {
    await fn().catch(() => {});
  }
  await provider.close();
});

describe('issue-comment service — transactional softDelete', () => {
  it('rolls back all writes when version check fails', async () => {
    const commentSvc = createIssueCommentService(db);

    const comment = await commentSvc.create(issueAId, {
      bodyMd: 'Body that should stay intact on rollback',
      author: 'ictest-user',
    });

    expect(comment.version).toBe(1);
    expect(comment.isDeleted).toBe(false);

    // Attempt soft-delete with wrong version — must throw VERSION_CONFLICT
    await expect(
      commentSvc.softDelete(comment.id, {
        deletedBy: 'ictest-user',
        version: 999,
      })
    ).rejects.toThrow(/VERSION_CONFLICT/);

    // Comment row unchanged
    const [row] = await db
      .select()
      .from(schema.issueComment)
      .where(eq(schema.issueComment.id, comment.id));
    expect(row.isDeleted).toBe(false);
    expect(row.bodyMd).toBe('Body that should stay intact on rollback');
    expect(row.version).toBe(1);

    // No comment_deleted event was inserted for this issue
    const deletedEvents = await db
      .select()
      .from(schema.issueEvent)
      .where(
        and(
          eq(schema.issueEvent.issueId, issueAId),
          eq(schema.issueEvent.type, 'comment_deleted')
        )
      );
    expect(deletedEvents).toHaveLength(0);
  });

  it('commits all writes when version check passes', async () => {
    const commentSvc = createIssueCommentService(db);

    const comment = await commentSvc.create(issueBId, {
      bodyMd: 'Body that will be captured in the event',
      author: 'ictest-user',
    });

    expect(comment.version).toBe(1);

    const result = await commentSvc.softDelete(comment.id, {
      deletedBy: 'ictest-user',
      version: 1,
    });

    expect(result.isDeleted).toBe(true);
    expect(result.bodyMd).toBe('');
    expect(result.bodyHtml).toBe('');
    expect(result.version).toBe(2);

    // Row in DB matches
    const [row] = await db
      .select()
      .from(schema.issueComment)
      .where(eq(schema.issueComment.id, comment.id));
    expect(row.isDeleted).toBe(true);
    expect(row.bodyMd).toBe('');
    expect(row.version).toBe(2);

    // Event captured original body
    const deletedEvents = await db
      .select()
      .from(schema.issueEvent)
      .where(
        and(
          eq(schema.issueEvent.issueId, issueBId),
          eq(schema.issueEvent.type, 'comment_deleted')
        )
      );
    expect(deletedEvents).toHaveLength(1);
    const payload = deletedEvents[0].payload as Record<string, unknown>;
    expect(payload.body_md).toBe('Body that will be captured in the event');
    expect(payload.comment_id).toBe(comment.id);
    expect(payload.deleted_by).toBe('ictest-user');
  });
});
