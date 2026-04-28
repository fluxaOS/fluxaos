/**
 * Integration tests: R-SETTINGS-ALPHA project settings router.
 *
 * Covers project.update (extended fields), project.setDefaultPipeline
 * (happy, cross-project rejection, clear), and system.env.getPublic
 * (allowlist shape).
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { organization, pipeline, project, user } from '@/core/db/schema';
import { appRouter } from '@/server/root';

function stamp(label: string): string {
  return `proj-set-${label}-${Date.now()}`;
}

async function makeFixture(
  db: ReturnType<SupabaseDatabaseProvider['getConnection']>
) {
  const s = stamp('fix');
  const [org] = await db
    .insert(organization)
    .values({ name: s, slug: s })
    .returning();
  const [userRow] = await db
    .insert(user)
    .values({ orgId: org.id, email: `${s}@test.local`, name: s, slug: s })
    .returning();
  const [projectRow] = await db
    .insert(project)
    .values({
      orgId: org.id,
      userId: userRow.id,
      name: s,
      slug: s,
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

  it('project.setDefaultPipeline sets a same-project pipeline', async () => {
    const f = await makeFixture(db);
    try {
      await caller.project.setDefaultPipeline({
        projectId: f.projectRow.id,
        pipelineId: f.pipe2.id,
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

  it('project.setDefaultPipeline rejects a cross-project pipeline', async () => {
    const f = await makeFixture(db);
    const other = await makeFixture(db);
    try {
      await expect(
        caller.project.setDefaultPipeline({
          projectId: f.projectRow.id,
          pipelineId: other.pipe1.id,
        })
      ).rejects.toThrow(/PIPELINE_NOT_IN_PROJECT/);
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

  it('project.setDefaultPipeline({ pipelineId: null }) clears the default', async () => {
    const f = await makeFixture(db);
    try {
      await caller.project.setDefaultPipeline({
        projectId: f.projectRow.id,
        pipelineId: f.pipe1.id,
      });
      await caller.project.setDefaultPipeline({
        projectId: f.projectRow.id,
        pipelineId: null,
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

  it('system.env.getPublic returns allowlisted keys', async () => {
    const result = await caller.system.env.getPublic();
    expect(Object.keys(result)).toContain('FLUXAOS_TARGET_REPO_PATH');
    // Value may be null (unset) or a string — both are valid shapes.
    expect(
      result.FLUXAOS_TARGET_REPO_PATH === null ||
        typeof result.FLUXAOS_TARGET_REPO_PATH === 'string'
    ).toBe(true);
  });
});
