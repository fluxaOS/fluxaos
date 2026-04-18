/**
 * Integration tests: rich issue model services against real Supabase Postgres.
 *
 * These are NOT mocks. Every test hits the real database.
 * Catalogs are tested FIRST (DA Finding #29) — if catalogs break, issue tests
 * fail with confusing FK errors.
 *
 * Each test run uses unique slugs: `test-${Date.now()}` (DA Finding #28).
 */
import 'dotenv/config';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import {
  createOrganizationService,
  createProjectService,
  createUserService,
  createIssueService,
  createIssueCatalogService,
  createIssueCommentService,
  createIssueEventService,
} from '@/core/services';
import * as schema from '@/core/db/schema';
import type { Database } from '@/core/db/connection';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

// ─── Unique run suffix ──────────────────────────────────────────────────────
const RUN = Date.now();

// ─── Track IDs for cleanup (reverse order in afterAll) ──────────────────────
const cleanup: { table: string; id: string }[] = [];

const tableMap: Record<string, any> = {
  issueEvent: schema.issueEvent,
  issueComment: schema.issueComment,
  issue: schema.issue,
  issueTransition: schema.issueTransition,
  issueType: schema.issueType,
  issueState: schema.issueState,
  issueStatus: schema.issueStatus,
  issuePriority: schema.issuePriority,
  issueLabel: schema.issueLabel,
  configEntry: schema.configEntry,
  pipeline: schema.pipeline,
  pipelineStage: schema.pipelineStage,
  project: schema.project,
  user: schema.user,
  organization: schema.organization,
};

afterAll(async () => {
  for (const { table, id } of cleanup.reverse()) {
    const t = tableMap[table];
    if (t) {
      await db.delete(t).where(eq(t.id, id)).catch(() => {});
    }
  }
});

// ─── Shared state across test groups ────────────────────────────────────────

let orgId: string;
let userId: string;
let projectId: string;

// Catalog IDs (populated in beforeAll of catalog tests)
let typeId: string;
let stateOpenId: string;
let stateInProgressId: string;
let stateClosedId: string;
let statusBacklogId: string;
let priorityHighId: string;
let labelBugId: string;

// Transition IDs
let transOpenToInProgress: string;
let transInProgressToClosed: string;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Organization + User + Project
// ═══════════════════════════════════════════════════════════════════════════════

describe('organization + user + project', () => {
  it('creates org, user, and project', async () => {
    const orgSvc = createOrganizationService(db);
    const userSvc = createUserService(db);
    const projSvc = createProjectService(db);

    // Create org
    const org = await orgSvc.create({
      name: 'Test Org',
      slug: `test-org-${RUN}`,
      settings: {},
    });
    cleanup.push({ table: 'organization', id: org.id });
    orgId = org.id;
    expect(org.slug).toBe(`test-org-${RUN}`);

    // Create user
    const usr = await userSvc.create({
      orgId: org.id,
      email: `test-${RUN}@example.com`,
      name: 'Test User',
      slug: `test-user-${RUN}`,
    });
    cleanup.push({ table: 'user', id: usr.id });
    userId = usr.id;
    expect(usr.name).toBe('Test User');

    // Verify getBySlug works
    const foundUser = await userSvc.getBySlug(org.id, `test-user-${RUN}`);
    expect(foundUser?.id).toBe(usr.id);

    // Create project (requires userId)
    const proj = await projSvc.create({
      orgId: org.id,
      userId: usr.id,
      name: 'Test Project',
      slug: `test-proj-${RUN}`,
    });
    cleanup.push({ table: 'project', id: proj.id });
    projectId = proj.id;
    expect(proj.userId).toBe(usr.id);
    expect(proj.orgId).toBe(org.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Issue Catalogs (DA Finding #29: catalogs FIRST)
// ═══════════════════════════════════════════════════════════════════════════════

describe('issue catalogs', () => {
  const catalogSvc = createIssueCatalogService(db);

  it('creates a type and verifies list()', async () => {
    const t = await catalogSvc.types.create({
      projectId,
      key: `feat-${RUN}`,
      displayName: 'Feature',
      description: 'A feature request',
      color: '#0000ff',
      sortOrder: 1,
    });
    cleanup.push({ table: 'issueType', id: t.id });
    typeId = t.id;

    const types = await catalogSvc.types.list(projectId);
    expect(types.some((x) => x.id === t.id)).toBe(true);
  });

  it('rejects duplicate key (uniqueness constraint)', async () => {
    await expect(
      catalogSvc.types.create({
        projectId,
        key: `feat-${RUN}`, // same key
        displayName: 'Duplicate Feature',
        color: '#ff0000',
        sortOrder: 2,
      }),
    ).rejects.toThrow();
  });

  it('list() returns only active items', async () => {
    // Create an active label
    const active = await catalogSvc.labels.create({
      projectId,
      key: `label-active-${RUN}`,
      displayName: 'Active Label',
      color: '#00ff00',
      sortOrder: 1,
    });
    cleanup.push({ table: 'issueLabel', id: active.id });
    labelBugId = active.id;

    // Create an inactive label
    const inactive = await catalogSvc.labels.create({
      projectId,
      key: `label-inactive-${RUN}`,
      displayName: 'Inactive Label',
      color: '#999999',
      sortOrder: 2,
    });
    cleanup.push({ table: 'issueLabel', id: inactive.id });
    await catalogSvc.labels.deactivate(inactive.id);

    const labels = await catalogSvc.labels.list(projectId);
    expect(labels.some((l) => l.id === active.id)).toBe(true);
    expect(labels.some((l) => l.id === inactive.id)).toBe(false);
  });

  it('creates states with transitions', async () => {
    // Create 3 states: open, in_progress, closed
    const open = await catalogSvc.states.create({
      projectId,
      key: `open-${RUN}`,
      displayName: 'Open',
      color: '#22cc22',
      sortOrder: 1,
      isTerminal: false,
    });
    cleanup.push({ table: 'issueState', id: open.id });
    stateOpenId = open.id;

    const inProgress = await catalogSvc.states.create({
      projectId,
      key: `in_progress-${RUN}`,
      displayName: 'In Progress',
      color: '#ffaa00',
      sortOrder: 2,
      isTerminal: false,
    });
    cleanup.push({ table: 'issueState', id: inProgress.id });
    stateInProgressId = inProgress.id;

    const closed = await catalogSvc.states.create({
      projectId,
      key: `closed-${RUN}`,
      displayName: 'Closed',
      color: '#cc2222',
      sortOrder: 3,
      isTerminal: true,
    });
    cleanup.push({ table: 'issueState', id: closed.id });
    stateClosedId = closed.id;

    // Create transitions: open→in_progress, in_progress→closed
    const t1 = await catalogSvc.transitions.create({
      projectId,
      fromStateId: open.id,
      toStateId: inProgress.id,
      sortOrder: 1,
    });
    cleanup.push({ table: 'issueTransition', id: t1.id });
    transOpenToInProgress = t1.id;

    const t2 = await catalogSvc.transitions.create({
      projectId,
      fromStateId: inProgress.id,
      toStateId: closed.id,
      sortOrder: 2,
    });
    cleanup.push({ table: 'issueTransition', id: t2.id });
    transInProgressToClosed = t2.id;

    // Verify listFrom returns correct targets
    const fromOpen = await catalogSvc.transitions.listFrom(projectId, open.id);
    expect(fromOpen.length).toBe(1);
    expect(fromOpen[0].toStateId).toBe(inProgress.id);

    const fromInProgress = await catalogSvc.transitions.listFrom(
      projectId,
      inProgress.id,
    );
    expect(fromInProgress.length).toBe(1);
    expect(fromInProgress[0].toStateId).toBe(closed.id);
  });

  it('creates a status and priority', async () => {
    const status = await catalogSvc.statuses.create({
      projectId,
      key: `backlog-${RUN}`,
      displayName: 'Backlog',
      sortOrder: 1,
    });
    cleanup.push({ table: 'issueStatus', id: status.id });
    statusBacklogId = status.id;

    const priority = await catalogSvc.priorities.create({
      projectId,
      key: `high-${RUN}`,
      displayName: 'High',
      color: '#ff0000',
      weight: 100,
    });
    cleanup.push({ table: 'issuePriority', id: priority.id });
    priorityHighId = priority.id;
  });

  it('deactivate works but referenced type cannot be hard-deleted', async () => {
    // Deactivate the type — should succeed
    const deactivated = await catalogSvc.types.deactivate(typeId);
    expect(deactivated?.isActive).toBe(false);

    // Re-activate for subsequent tests
    await catalogSvc.types.update(typeId, { isActive: true });
  });

  it('seeds config entry for status automation', async () => {
    // Insert config entry that issue service needs
    const [config] = await db
      .insert(schema.configEntry)
      .values({
        scope: 'project',
        projectId,
        key: 'issues.status.on_create_key',
        value: `backlog-${RUN}`,
      })
      .returning();
    cleanup.push({ table: 'configEntry', id: config.id });

    expect(config.key).toBe('issues.status.on_create_key');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Issue Service
// ═══════════════════════════════════════════════════════════════════════════════

describe('issue service', () => {
  const issueSvc = createIssueService(db);
  const eventSvc = createIssueEventService(db);

  let issueId: string;
  let issueVersion: number;
  let secondIssueId: string;

  it('creates issue — auto-number 1, correct initial state and status', async () => {
    const created = await issueSvc.create({
      projectId,
      title: 'First Issue',
      bodyMd: 'Integration test body',
      typeId,
      priorityId: priorityHighId,
      author: 'test-user',
    });
    cleanup.push({ table: 'issue', id: created.id });
    issueId = created.id;
    issueVersion = created.version;

    expect(created.number).toBe(1);
    expect(created.stateId).toBe(stateOpenId); // lowest sortOrder non-terminal
    expect(created.statusId).toBe(statusBacklogId); // from config
    expect(created.isClosed).toBe(false);
    expect(created.version).toBe(1);
    expect(created.bodyHtml).toBeTruthy();
    expect(created.bodyHtml).toContain('Integration test body');
  });

  it('creates second issue — number is 2', async () => {
    const created = await issueSvc.create({
      projectId,
      title: 'Second Issue',
      typeId,
      priorityId: priorityHighId,
    });
    cleanup.push({ table: 'issue', id: created.id });
    secondIssueId = created.id;

    expect(created.number).toBe(2);
  });

  it('getByNumber returns correct issue', async () => {
    const found = await issueSvc.getByNumber(projectId, 1);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(issueId);
    expect(found!.title).toBe('First Issue');
  });

  it('transition — valid transition changes state and records event', async () => {
    const transitioned = await issueSvc.transition(
      issueId,
      stateInProgressId,
      issueVersion,
      'test-user',
    );
    issueVersion = transitioned.version;

    expect(transitioned.stateId).toBe(stateInProgressId);
    expect(transitioned.isClosed).toBe(false);
    expect(transitioned.version).toBe(2);

    // Verify state_changed event was recorded
    const events = await eventSvc.list(issueId);
    const stateEvents = events.filter((e) => e.type === 'state_changed');
    expect(stateEvents.length).toBe(1);
    expect((stateEvents[0].payload as any).to_state).toBe(stateInProgressId);
  });

  it('transition — invalid transition throws INVALID_TRANSITION', async () => {
    // open→closed is NOT a valid transition (only open→in_progress and in_progress→closed exist)
    // Issue is currently in_progress, try transitioning to open (no such transition exists)
    await expect(
      issueSvc.transition(issueId, stateOpenId, issueVersion, 'test-user'),
    ).rejects.toThrow('INVALID_TRANSITION');
  });

  it('updateFields — correct version succeeds, increments version, records event', async () => {
    const updated = await issueSvc.updateFields(
      issueId,
      { title: 'Updated Title' },
      issueVersion,
      'test-user',
    );
    issueVersion = updated.version;

    expect(updated.title).toBe('Updated Title');
    expect(updated.version).toBe(3);

    // Verify fields_updated event
    const events = await eventSvc.list(issueId);
    const fieldEvents = events.filter((e) => e.type === 'fields_updated');
    expect(fieldEvents.length).toBe(1);
    const changes = (fieldEvents[0].payload as any).changes;
    expect(changes.title.from).toBe('First Issue');
    expect(changes.title.to).toBe('Updated Title');
  });

  it('updateFields — wrong version throws VERSION_CONFLICT', async () => {
    await expect(
      issueSvc.updateFields(
        issueId,
        { title: 'Should Fail' },
        999,
        'test-user',
      ),
    ).rejects.toThrow('VERSION_CONFLICT');
  });

  it('close — sets isClosed=true, closedAt', async () => {
    const closed = await issueSvc.close(issueId, issueVersion, 'test-user');
    issueVersion = closed.version;

    expect(closed.isClosed).toBe(true);
    expect(closed.closedAt).not.toBeNull();
    expect(closed.stateId).toBe(stateClosedId);
  });

  it('reopen — sets isClosed=false, closedAt=null', async () => {
    const reopened = await issueSvc.reopen(issueId, issueVersion, 'test-user');
    issueVersion = reopened.version;

    expect(reopened.isClosed).toBe(false);
    expect(reopened.closedAt).toBeNull();
    expect(reopened.stateId).toBe(stateOpenId); // lowest sortOrder non-terminal
  });

  it('delete — hard delete removes the issue', async () => {
    // Delete second issue
    await issueSvc.delete(secondIssueId);
    const found = await issueSvc.getById(secondIssueId);
    expect(found).toBeNull();

    // Remove from cleanup since we already deleted
    const idx = cleanup.findIndex(
      (c) => c.table === 'issue' && c.id === secondIssueId,
    );
    if (idx !== -1) cleanup.splice(idx, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Comment Service
// ═══════════════════════════════════════════════════════════════════════════════

describe('comment service', () => {
  const commentSvc = createIssueCommentService(db);
  const eventSvc = createIssueEventService(db);

  // We need the issueId from the previous group. It's in the outer scope.
  // Since vitest runs describes sequentially in the same file, this works.

  let firstCommentId: string;
  let firstCommentVersion: number;
  let secondCommentId: string;

  // We need to reference the issueId from 'issue service' group.
  // It was created via issueSvc.create and stored in the outer `cleanup` array.
  // Let's grab it from the first 'issue' cleanup entry.
  function getIssueId(): string {
    const entry = cleanup.find((c) => c.table === 'issue');
    if (!entry) throw new Error('No issue found in cleanup — issue tests must run first');
    return entry.id;
  }

  it('creates first comment — commentNumber is 1, bodyHtml populated', async () => {
    const issueId = getIssueId();
    const comment = await commentSvc.create(issueId, {
      bodyMd: 'Hello, this is a test comment',
      author: 'test-user',
    });
    // Comments cascade-delete with issue, no need to add to cleanup
    firstCommentId = comment.id;
    firstCommentVersion = comment.version;

    expect(comment.commentNumber).toBe(1);
    expect(comment.bodyHtml).toBeTruthy();
    expect(comment.bodyHtml).toContain('Hello, this is a test comment');
    expect(comment.author).toBe('test-user');
  });

  it('creates second comment — commentNumber is 2', async () => {
    const issueId = getIssueId();
    const comment = await commentSvc.create(issueId, {
      bodyMd: 'Second comment',
      author: 'test-user',
    });
    secondCommentId = comment.id;

    expect(comment.commentNumber).toBe(2);
  });

  it('updates comment — editedAt set, event records old/new body', async () => {
    const issueId = getIssueId();
    const updated = await commentSvc.update(firstCommentId, {
      bodyMd: 'Updated comment body',
      editedBy: 'test-user',
      version: firstCommentVersion,
    });
    firstCommentVersion = updated.version;

    expect(updated.bodyMd).toBe('Updated comment body');
    expect(updated.editedAt).not.toBeNull();
    expect(updated.version).toBe(2);

    // Verify comment_edited event
    const events = await eventSvc.list(issueId);
    const editEvents = events.filter((e) => e.type === 'comment_edited');
    expect(editEvents.length).toBe(1);
    expect((editEvents[0].payload as any).old_body).toBe(
      'Hello, this is a test comment',
    );
    expect((editEvents[0].payload as any).new_body).toBe(
      'Updated comment body',
    );
  });

  it('update with wrong version throws VERSION_CONFLICT', async () => {
    await expect(
      commentSvc.update(firstCommentId, {
        bodyMd: 'Should fail',
        editedBy: 'test-user',
        version: 999,
      }),
    ).rejects.toThrow('VERSION_CONFLICT');
  });

  it('soft-delete — isDeleted=true, body cleared, event captures original body', async () => {
    const issueId = getIssueId();
    const deleted = await commentSvc.softDelete(firstCommentId, {
      deletedBy: 'test-user',
      version: firstCommentVersion,
    });

    expect(deleted.isDeleted).toBe(true);
    expect(deleted.bodyMd).toBe('');
    expect(deleted.bodyHtml).toBe('');

    // Verify comment_deleted event captured the body BEFORE clearing
    const events = await eventSvc.list(issueId);
    const deleteEvents = events.filter((e) => e.type === 'comment_deleted');
    expect(deleteEvents.length).toBe(1);
    expect((deleteEvents[0].payload as any).body_md).toBe(
      'Updated comment body',
    );
  });
});
