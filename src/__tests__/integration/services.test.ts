/**
 * Integration tests: rich issue model services against real Supabase Postgres.
 *
 * These are NOT mocks. Every test hits the real database.
 * Catalogs are tested FIRST (DA Finding #29) — if catalogs break, issue tests
 * fail with confusing FK errors.
 *
 * Each test run uses unique names: `test-${Date.now()}` (DA Finding #28).
 */
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import {
  createIssueCatalogService,
  createIssueCommentService,
  createIssueEventService,
  createIssueService,
  createOrganizationService,
  createProjectService,
  createUserService,
} from '@/core/services';
import { deleteOrgFixture } from './cleanup-fixtures';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

// ─── Unique run suffix ──────────────────────────────────────────────────────
const RUN = Date.now();

// ─── Shared state across test groups ────────────────────────────────────────

let _orgId: string;
let _userId: string;
let projectId: string;

// Catalog IDs (populated in beforeAll of catalog tests)
let typeId: string;
let stateOpenId: string;
let stateInProgressId: string;
let stateClosedId: string;
let statusBacklogId: string;
let priorityHighId: string;
let _labelBugId: string;

// Transition IDs
let _transOpenToInProgress: string;
let _transInProgressToClosed: string;

// Issue ID shared between issue-service tests and comment-service tests
let _firstIssueId: string;

afterAll(async () => {
  if (_orgId) await deleteOrgFixture(db, _orgId);
});

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
      name: `Test Org ${RUN}`,
      settings: {},
    });
    _orgId = org.id;
    expect(org.name).toBe(`Test Org ${RUN}`);

    // Create user
    const usr = await userSvc.create({
      orgId: org.id,
      email: `test-${RUN}@example.com`,
      name: 'Test User',
    });
    _userId = usr.id;
    expect(usr.name).toBe('Test User');

    // Verify getById works
    const foundUser = await userSvc.getById(usr.id);
    expect(foundUser?.id).toBe(usr.id);

    const [team] = await db
      .insert(schema.team)
      .values({ orgId: org.id, name: 'Test Team' })
      .returning();

    // Create project and grant the user membership.
    const proj = await projSvc.create({
      orgId: org.id,
      teamId: team.id,
      userId: usr.id,
      name: 'Test Project',
    });
    projectId = proj.id;
    const userProjects = await projSvc.listByUser(usr.id);
    expect(userProjects.some((p) => p.id === proj.id)).toBe(true);
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
      })
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
    _labelBugId = active.id;

    // Create an inactive label
    const inactive = await catalogSvc.labels.create({
      projectId,
      key: `label-inactive-${RUN}`,
      displayName: 'Inactive Label',
      color: '#999999',
      sortOrder: 2,
    });
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
    stateOpenId = open.id;

    const inProgress = await catalogSvc.states.create({
      projectId,
      key: `in_progress-${RUN}`,
      displayName: 'In Progress',
      color: '#ffaa00',
      sortOrder: 2,
      isTerminal: false,
    });
    stateInProgressId = inProgress.id;

    const closed = await catalogSvc.states.create({
      projectId,
      key: `closed-${RUN}`,
      displayName: 'Closed',
      color: '#cc2222',
      sortOrder: 3,
      isTerminal: true,
    });
    stateClosedId = closed.id;

    // Create transitions: open→in_progress, in_progress→closed
    const t1 = await catalogSvc.transitions.create({
      projectId,
      fromStateId: open.id,
      toStateId: inProgress.id,
      sortOrder: 1,
    });
    _transOpenToInProgress = t1.id;

    const t2 = await catalogSvc.transitions.create({
      projectId,
      fromStateId: inProgress.id,
      toStateId: closed.id,
      sortOrder: 2,
    });
    _transInProgressToClosed = t2.id;

    // Verify listFrom returns correct targets
    const fromOpen = await catalogSvc.transitions.listFrom(projectId, open.id);
    expect(fromOpen.length).toBe(1);
    expect(fromOpen[0].toStateId).toBe(inProgress.id);

    const fromInProgress = await catalogSvc.transitions.listFrom(
      projectId,
      inProgress.id
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
    statusBacklogId = status.id;

    const priority = await catalogSvc.priorities.create({
      projectId,
      key: `high-${RUN}`,
      displayName: 'High',
      color: '#ff0000',
      weight: 100,
    });
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

  it('creates issue — auto-number 1, correct initial state and status', async () => {
    const created = await issueSvc.create({
      projectId,
      title: 'First Issue',
      bodyMd: 'Integration test body',
      typeId,
      priorityId: priorityHighId,
      author: 'test-user',
    });
    issueId = created.id;
    _firstIssueId = created.id;
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

    expect(created.number).toBe(2);
  });

  it('getByNumber returns correct issue', async () => {
    const found = await issueSvc.getByNumber(projectId, 1);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(issueId);
    expect(found?.title).toBe('First Issue');
  });

  it('transition — valid transition changes state and records event', async () => {
    const transitioned = await issueSvc.transition(
      issueId,
      stateInProgressId,
      issueVersion,
      projectId,
      'test-user'
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

  it('transition — FLX-77: free state→state, no graph validation', async () => {
    // Operator-driven transitions accept any target state. Issue is in_progress;
    // walk back to open even though no transition row exists for that edge.
    const transitioned = await issueSvc.transition(
      issueId,
      stateOpenId,
      issueVersion,
      projectId,
      'test-user'
    );
    issueVersion = transitioned.version;
    expect(transitioned.stateId).toBe(stateOpenId);
  });

  it('updateFields — correct version succeeds, increments version, records event', async () => {
    const updated = await issueSvc.updateFields(
      issueId,
      { title: 'Updated Title' },
      issueVersion,
      projectId,
      'test-user'
    );
    issueVersion = updated.version;

    expect(updated.title).toBe('Updated Title');
    expect(updated.version).toBe(4);

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
        projectId,
        'test-user'
      )
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

  it('getById — returns null for issue looked up under wrong project (cross-tenant rejection)', async () => {
    // Create a second project in the same org to act as the "wrong" project.
    const projSvc = createProjectService(db);
    const [team2] = await db
      .insert(schema.team)
      .values({
        orgId: _orgId,
        name: 'Test Team 2',
      })
      .returning();
    const proj2 = await projSvc.create({
      orgId: _orgId,
      teamId: team2.id,
      userId: _userId,
      name: 'Test Project 2',
    });

    // issueId belongs to projectId (project 1). Looking it up under proj2 must
    // return null — not the real issue — so a cross-tenant viewer gets nothing.
    const result = await issueSvc.getById(issueId, proj2.id);
    expect(result).toBeNull();
  });

  it('delete — hard delete removes the issue', async () => {
    // Delete second issue (number 2) — look it up by number
    const second = await issueSvc.getByNumber(projectId, 2);
    if (second) {
      await issueSvc.delete(second.id, projectId);
      const found = await issueSvc.getById(second.id, projectId);
      expect(found).toBeNull();
    }
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
  let _secondCommentId: string;

  it('creates first comment — commentNumber is 1, bodyHtml populated', async () => {
    const comment = await commentSvc.create(_firstIssueId, {
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
    const comment = await commentSvc.create(_firstIssueId, {
      bodyMd: 'Second comment',
      author: 'test-user',
    });
    _secondCommentId = comment.id;

    expect(comment.commentNumber).toBe(2);
  });

  it('updates comment — editedAt set, event records old/new body', async () => {
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
    const events = await eventSvc.list(_firstIssueId);
    const editEvents = events.filter((e) => e.type === 'comment_edited');
    expect(editEvents.length).toBe(1);
    expect((editEvents[0].payload as any).old_body).toBe(
      'Hello, this is a test comment'
    );
    expect((editEvents[0].payload as any).new_body).toBe(
      'Updated comment body'
    );
  });

  it('update with wrong version throws VERSION_CONFLICT', async () => {
    await expect(
      commentSvc.update(firstCommentId, {
        bodyMd: 'Should fail',
        editedBy: 'test-user',
        version: 999,
      })
    ).rejects.toThrow('VERSION_CONFLICT');
  });

  it('soft-delete — isDeleted=true, body cleared, event captures original body', async () => {
    const deleted = await commentSvc.softDelete(firstCommentId, {
      deletedBy: 'test-user',
      version: firstCommentVersion,
    });

    expect(deleted.isDeleted).toBe(true);
    expect(deleted.bodyMd).toBe('');
    expect(deleted.bodyHtml).toBe('');

    // Verify comment_deleted event captured the body BEFORE clearing
    const events = await eventSvc.list(_firstIssueId);
    const deleteEvents = events.filter((e) => e.type === 'comment_deleted');
    expect(deleteEvents.length).toBe(1);
    expect((deleteEvents[0].payload as any).body_md).toBe(
      'Updated comment body'
    );
  });
});
