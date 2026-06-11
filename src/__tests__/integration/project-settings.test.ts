/**
 * Integration tests: R-SETTINGS-ALPHA project settings router.
 *
 * Covers project.update (extended fields + defaultPipelineId, including
 * the cross-project rejection and null-clear that FLX-228 consolidated
 * into project.update's service-layer FK guard). The legacy
 * system.env.getPublic endpoint was retired in FLX-221 — its only
 * whitelisted key moved to a per-project DB column, and the endpoint had
 * no other consumers.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import {
  configEntry,
  issueStatus,
  organization,
  pipeline,
  project,
  team,
  user,
} from '@/core/db/schema';
import { appRouter } from '@/server/root';

function stamp(label: string): string {
  return `proj-set-${label}-${Date.now()}`;
}

async function makeFixture(
  db: ReturnType<SupabaseDatabaseProvider['getConnection']>
) {
  const s = stamp('fix');
  const [org] = await db.insert(organization).values({ name: s }).returning();
  const [userRow] = await db
    .insert(user)
    .values({ orgId: org.id, email: `${s}@test.local`, name: s })
    .returning();
  const [projectRow] = await db
    .insert(project)
    .values({
      orgId: org.id,
      teamId: (
        await db
          .insert(team)
          .values({ orgId: org.id, name: `${s}-team` })
          .returning()
      )[0].id,
      name: s,
      repoUrl: 'https://github.com/fluxaos/fixture',
      defaultBranch: 'main',
    })
    .returning();
  const [pipe1] = await db
    .insert(pipeline)
    .values({ projectId: projectRow.id, name: `${s}-p1` })
    .returning();
  const [pipe2] = await db
    .insert(pipeline)
    .values({ projectId: projectRow.id, name: `${s}-p2` })
    .returning();
  // FLX-270: the issue-watcher validates dispatch config for every project
  // with a defaultPipelineId at daemon boot. These tests transiently set
  // defaultPipelineId, so the fixture must carry a valid dispatch config to
  // avoid failing a concurrently-booting daemon in another suite.
  await db.insert(issueStatus).values({
    projectId: projectRow.id,
    key: 'open',
    displayName: 'Open',
    sortOrder: 1,
  });
  await db.insert(configEntry).values({
    scope: 'project',
    projectId: projectRow.id,
    key: 'issues.status.on_create_key',
    value: 'open',
  });
  return { org, userRow, projectRow, pipe1, pipe2 };
}

async function teardown(
  db: ReturnType<SupabaseDatabaseProvider['getConnection']>,
  ids: { orgId: string; userId: string; projectId: string }
) {
  await db
    .delete(pipeline)
    .where(eq(pipeline.projectId, ids.projectId))
    .catch(() => undefined);
  await db
    .delete(configEntry)
    .where(eq(configEntry.projectId, ids.projectId))
    .catch(() => undefined);
  await db
    .delete(issueStatus)
    .where(eq(issueStatus.projectId, ids.projectId))
    .catch(() => undefined);
  await db
    .delete(project)
    .where(eq(project.id, ids.projectId))
    .catch(() => undefined);
  await db
    .delete(user)
    .where(eq(user.id, ids.userId))
    .catch(() => undefined);
  await db
    .delete(organization)
    .where(eq(organization.id, ids.orgId))
    .catch(() => undefined);
}

describe('R-SETTINGS-ALPHA project router', () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');
  const dbProvider = new SupabaseDatabaseProvider(url);
  const db = dbProvider.getConnection();
  const caller = appRouter.createCaller({
    db,
    viewer: {
      authUserId: null,
      fluxaUserId: null,
      role: 'admin',
      tier: 'enterprise',
    },
  });

  it('project.update accepts defaultBranch + defaultPipelineId', async () => {
    const f = await makeFixture(db);
    try {
      await caller.project.update({
        id: f.projectRow.id,
        defaultBranch: 'develop',
        defaultPipelineId: f.pipe1.id,
      });
      const [after] = await db
        .select()
        .from(project)
        .where(eq(project.id, f.projectRow.id));
      expect(after.defaultBranch).toBe('develop');
      expect(after.defaultPipelineId).toBe(f.pipe1.id);
    } finally {
      await teardown(db, {
        orgId: f.org.id,
        userId: f.userRow.id,
        projectId: f.projectRow.id,
      });
    }
  });

  it('project.update (defaultPipelineId) sets a same-project pipeline', async () => {
    const f = await makeFixture(db);
    try {
      await caller.project.update({
        id: f.projectRow.id,
        defaultPipelineId: f.pipe2.id,
      });
      const [after] = await db
        .select()
        .from(project)
        .where(eq(project.id, f.projectRow.id));
      expect(after.defaultPipelineId).toBe(f.pipe2.id);
    } finally {
      await teardown(db, {
        orgId: f.org.id,
        userId: f.userRow.id,
        projectId: f.projectRow.id,
      });
    }
  });

  it('project.update (defaultPipelineId) rejects a cross-project pipeline', async () => {
    const f = await makeFixture(db);
    const other = await makeFixture(db);
    try {
      await expect(
        caller.project.update({
          id: f.projectRow.id,
          defaultPipelineId: other.pipe1.id,
        })
      ).rejects.toMatchObject({ message: 'PIPELINE_NOT_IN_PROJECT' });
    } finally {
      await teardown(db, {
        orgId: f.org.id,
        userId: f.userRow.id,
        projectId: f.projectRow.id,
      });
      await teardown(db, {
        orgId: other.org.id,
        userId: other.userRow.id,
        projectId: other.projectRow.id,
      });
    }
  });

  it('project.update ({ defaultPipelineId: null }) clears the default', async () => {
    const f = await makeFixture(db);
    try {
      await caller.project.update({
        id: f.projectRow.id,
        defaultPipelineId: f.pipe1.id,
      });
      await caller.project.update({
        id: f.projectRow.id,
        defaultPipelineId: null,
      });
      const [after] = await db
        .select()
        .from(project)
        .where(eq(project.id, f.projectRow.id));
      expect(after.defaultPipelineId).toBeNull();
    } finally {
      await teardown(db, {
        orgId: f.org.id,
        userId: f.userRow.id,
        projectId: f.projectRow.id,
      });
    }
  });
});
