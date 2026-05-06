/**
 * R-EPIC integration tests — parent/child issue hierarchy.
 *
 * Covers:
 *   1. Service-layer parent/child queries (getChildren, hasOpenChildren).
 *   2. Auto-close: closing the last open child closes the parent with a
 *      structured `state_changed` event (reason=auto_close_all_children_closed).
 *   3. Schema invariants (self-parent rejected by CHECK, cross-project by trigger).
 *
 * Runs against real Supabase per project convention. Each test run arranges a
 * fresh project + issue-lifecycle catalog so cleanup is deterministic.
 */
import 'dotenv/config';
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import { createIssueService } from '@/core/services/issue';
import { deleteOrgFixture } from './cleanup-fixtures';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

const RUN = Date.now();
const orgIds: string[] = [];

// Suite-wide IDs arranged in beforeAll
let projectId: string;
let projectIdB: string; // for cross-project test
let issueTypeId: string;
let issueTypeIdB: string;
let issueStateIdClosed: string;
let issuePriorityId: string;
let issuePriorityIdB: string;

afterAll(async () => {
  for (const orgId of orgIds) {
    await deleteOrgFixture(db, orgId);
  }
  await provider.close();
});

async function arrangeProject(suffix: string) {
  const [org] = await db
    .insert(schema.organization)
    .values({
      name: `epic-org-${RUN}-${suffix}`,
      slug: `epic-org-${RUN}-${suffix}`,
    })
    .returning();
  orgIds.push(org.id);

  const [user] = await db
    .insert(schema.user)
    .values({
      orgId: org.id,
      email: `epic-${RUN}-${suffix}@test.local`,
      name: 'Epic',
      slug: `epic-${RUN}-${suffix}`,
    })
    .returning();

  const [proj] = await db
    .insert(schema.project)
    .values({
      orgId: org.id,
      userId: user.id,
      name: `epic-proj-${RUN}-${suffix}`,
      slug: `epic-proj-${RUN}-${suffix}`,
      repoUrl: 'https://github.com/fluxaos/epic-fixture',
      defaultBranch: 'main',
    })
    .returning();

  const [itype] = await db
    .insert(schema.issueType)
    .values({
      projectId: proj.id,
      key: `feat-${RUN}-${suffix}`,
      displayName: 'Feat',
      color: '#000',
      sortOrder: 1,
    })
    .returning();

  const [openState] = await db
    .insert(schema.issueState)
    .values({
      projectId: proj.id,
      key: `open-${RUN}-${suffix}`,
      displayName: 'Open',
      sortOrder: 1,
      color: '#000',
      isTerminal: false,
    })
    .returning();

  const [closedState] = await db
    .insert(schema.issueState)
    .values({
      projectId: proj.id,
      key: `closed-${RUN}-${suffix}`,
      displayName: 'Closed',
      sortOrder: 2,
      color: '#000',
      isTerminal: true,
    })
    .returning();

  // Transition open → closed so transition() path also works (stateOverride
  // doesn't need one but we test both)
  await db
    .insert(schema.issueTransition)
    .values({
      projectId: proj.id,
      fromStateId: openState.id,
      toStateId: closedState.id,
      sortOrder: 1,
    })
    .returning();

  const [istatus] = await db
    .insert(schema.issueStatus)
    .values({
      projectId: proj.id,
      key: `open-st-${RUN}-${suffix}`,
      displayName: 'OpenSt',
      sortOrder: 1,
    })
    .returning();

  const [iprio] = await db
    .insert(schema.issuePriority)
    .values({
      projectId: proj.id,
      key: `med-${RUN}-${suffix}`,
      displayName: 'Med',
      weight: 1,
      color: '#000',
    })
    .returning();

  // Config entry so createIssueService.create works.
  await db
    .insert(schema.configEntry)
    .values({
      scope: 'project',
      projectId: proj.id,
      key: 'issues.status.on_create_key',
      value: `open-st-${RUN}-${suffix}`,
    })
    .returning();

  return {
    projectId: proj.id,
    issueTypeId: itype.id,
    openStateId: openState.id,
    closedStateId: closedState.id,
    statusId: istatus.id,
    priorityId: iprio.id,
  };
}

beforeAll(async () => {
  const a = await arrangeProject('A');
  projectId = a.projectId;
  issueTypeId = a.issueTypeId;
  issueStateIdClosed = a.closedStateId;
  issuePriorityId = a.priorityId;

  const b = await arrangeProject('B');
  projectIdB = b.projectId;
  issueTypeIdB = b.issueTypeId;
  issuePriorityIdB = b.priorityId;
}, 30000);

describe('R-EPIC — parent/child hierarchy', () => {
  it('getChildren returns children ordered by number; hasOpenChildren flips to false when all close', async () => {
    const svc = createIssueService(db);

    const parent = await svc.create({
      projectId,
      title: 'epic-parent',
      typeId: issueTypeId,
      priorityId: issuePriorityId,
    });

    const child1 = await svc.create({
      projectId,
      title: 'epic-child-1',
      typeId: issueTypeId,
      priorityId: issuePriorityId,
      parentIssueId: parent.id,
    });

    const child2 = await svc.create({
      projectId,
      title: 'epic-child-2',
      typeId: issueTypeId,
      priorityId: issuePriorityId,
      parentIssueId: parent.id,
    });

    const kids = await svc.getChildren(parent.id);
    expect(kids.length).toBe(2);
    // Ordered by number ascending
    expect(kids[0].number).toBeLessThan(kids[1].number);
    expect(kids.map((k) => k.id).sort()).toEqual([child1.id, child2.id].sort());

    expect(await svc.hasOpenChildren(parent.id)).toBe(true);

    // Close child1 directly via stateOverride (non-terminal → terminal)
    await svc.stateOverride(
      child1.id,
      issueStateIdClosed,
      child1.version,
      'test'
    );
    expect(await svc.hasOpenChildren(parent.id)).toBe(true); // child2 still open

    // Close child2 — last open child
    await svc.stateOverride(
      child2.id,
      issueStateIdClosed,
      child2.version,
      'test'
    );
    expect(await svc.hasOpenChildren(parent.id)).toBe(false);
  });

  it('closing the last open child auto-closes the parent with structured state_changed event', async () => {
    const svc = createIssueService(db);

    const parent = await svc.create({
      projectId,
      title: 'auto-close-parent',
      typeId: issueTypeId,
      priorityId: issuePriorityId,
    });

    const child = await svc.create({
      projectId,
      title: 'auto-close-child',
      typeId: issueTypeId,
      priorityId: issuePriorityId,
      parentIssueId: parent.id,
    });

    expect(parent.isClosed).toBe(false);

    // Close the one child — parent should auto-close.
    await svc.stateOverride(
      child.id,
      issueStateIdClosed,
      child.version,
      'test'
    );

    // Reload parent and assert closed.
    const parentAfter = await svc.getById(parent.id, projectId);
    expect(parentAfter?.isClosed).toBe(true);
    expect(parentAfter?.closedAt).not.toBeNull();
    expect(parentAfter?.stateId).toBe(issueStateIdClosed);

    // Assert the structured event fired.
    const events = await db
      .select()
      .from(schema.issueEvent)
      .where(
        and(
          eq(schema.issueEvent.issueId, parent.id),
          eq(schema.issueEvent.type, 'state_changed')
        )
      )
      .orderBy(desc(schema.issueEvent.createdAt));

    const auto = events.find(
      (e) =>
        (e.payload as Record<string, unknown> | null)?.reason ===
        'auto_close_all_children_closed'
    );
    expect(auto).toBeDefined();
    expect((auto?.payload as Record<string, unknown>).last_child).toBe(
      child.id
    );
    expect(auto?.actor).toBe('orchestrator');
  });

  it('transition() path (not just stateOverride) fires auto-close', async () => {
    const svc = createIssueService(db);

    const parent = await svc.create({
      projectId,
      title: 'transition-parent',
      typeId: issueTypeId,
      priorityId: issuePriorityId,
    });

    const child = await svc.create({
      projectId,
      title: 'transition-child',
      typeId: issueTypeId,
      priorityId: issuePriorityId,
      parentIssueId: parent.id,
    });

    // transition() uses the transition graph: open → closed exists per beforeAll.
    await svc.transition(
      child.id,
      issueStateIdClosed,
      child.version,
      'test',
      projectId
    );

    const parentAfter = await svc.getById(parent.id, projectId);
    expect(parentAfter?.isClosed).toBe(true);
  });

  it('rejects self-parenting (DB CHECK)', async () => {
    const svc = createIssueService(db);

    const issue = await svc.create({
      projectId,
      title: 'self-parent-test',
      typeId: issueTypeId,
      priorityId: issuePriorityId,
    });

    await expect(
      db
        .update(schema.issue)
        .set({ parentIssueId: issue.id })
        .where(eq(schema.issue.id, issue.id))
    ).rejects.toThrow();
  });

  it('rejects cross-project parenting (service guard + DB trigger)', async () => {
    const svc = createIssueService(db);

    const parentA = await svc.create({
      projectId,
      title: 'cross-project-parent',
      typeId: issueTypeId,
      priorityId: issuePriorityId,
    });

    // Try to create in project B with parent from project A — service layer rejects.
    await expect(
      svc.create({
        projectId: projectIdB,
        title: 'cross-project-child',
        typeId: issueTypeIdB,
        priorityId: issuePriorityIdB,
        parentIssueId: parentA.id,
      })
    ).rejects.toThrow(/CROSS_PROJECT_PARENT/);
  });

  it('auto-close propagates up the tree (grandparent)', async () => {
    const svc = createIssueService(db);

    const grandparent = await svc.create({
      projectId,
      title: 'gp',
      typeId: issueTypeId,
      priorityId: issuePriorityId,
    });

    const parent = await svc.create({
      projectId,
      title: 'p',
      typeId: issueTypeId,
      priorityId: issuePriorityId,
      parentIssueId: grandparent.id,
    });

    const child = await svc.create({
      projectId,
      title: 'c',
      typeId: issueTypeId,
      priorityId: issuePriorityId,
      parentIssueId: parent.id,
    });

    await svc.stateOverride(
      child.id,
      issueStateIdClosed,
      child.version,
      'test'
    );

    const parentAfter = await svc.getById(parent.id, projectId);
    const grandparentAfter = await svc.getById(grandparent.id, projectId);
    expect(parentAfter?.isClosed).toBe(true);
    expect(grandparentAfter?.isClosed).toBe(true);
  });

  it('getById includes hasOpenChildren scalar', async () => {
    const svc = createIssueService(db);

    const parent = await svc.create({
      projectId,
      title: 'enriched-getById-parent',
      typeId: issueTypeId,
      priorityId: issuePriorityId,
    });

    let loaded = await svc.getById(parent.id, projectId);
    expect(loaded?.hasOpenChildren).toBe(false);

    const _child = await svc.create({
      projectId,
      title: 'enriched-getById-child',
      typeId: issueTypeId,
      priorityId: issuePriorityId,
      parentIssueId: parent.id,
    });

    loaded = await svc.getById(parent.id, projectId);
    expect(loaded?.hasOpenChildren).toBe(true);
  });
});
