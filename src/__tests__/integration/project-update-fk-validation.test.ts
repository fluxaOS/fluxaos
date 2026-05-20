import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import {
  brand,
  organization,
  pipeline,
  project,
  team,
  user,
} from '@/core/db/schema';
import { appRouter } from '@/server/root';

function stamp(label: string): string {
  return `fk-${label}-${Date.now()}`;
}

async function makeFixture(
  db: ReturnType<SupabaseDatabaseProvider['getConnection']>,
  label: string
) {
  const s = stamp(label);
  const [org] = await db
    .insert(organization)
    .values({ name: s, slug: s })
    .returning();
  const [userRow] = await db
    .insert(user)
    .values({ orgId: org.id, email: `${s}@test.local`, name: s, slug: s })
    .returning();
  const [projRow] = await db
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
      slug: s,
      defaultBranch: 'main',
    })
    .returning();
  return { org, userRow, projRow };
}

async function teardown(
  db: ReturnType<SupabaseDatabaseProvider['getConnection']>,
  ids: { orgId: string; userId: string; projectId: string }
) {
  await db
    .delete(brand)
    .where(eq(brand.orgId, ids.orgId))
    .catch(() => undefined);
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

describe('project.update FK validation (FLX-228, FLX-229)', () => {
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

  it('rejects defaultPipelineId from a different project', async () => {
    const fA = await makeFixture(db, 'pipe-cross-a');
    const fB = await makeFixture(db, 'pipe-cross-b');
    try {
      const [otherPipe] = await db
        .insert(pipeline)
        .values({ projectId: fB.projRow.id, name: `${stamp('p')}` })
        .returning();
      await expect(
        caller.project.update({
          id: fA.projRow.id,
          defaultPipelineId: otherPipe.id,
        })
      ).rejects.toMatchObject({ message: 'PIPELINE_NOT_IN_PROJECT' });
    } finally {
      await teardown(db, {
        orgId: fA.org.id,
        userId: fA.userRow.id,
        projectId: fA.projRow.id,
      });
      await teardown(db, {
        orgId: fB.org.id,
        userId: fB.userRow.id,
        projectId: fB.projRow.id,
      });
    }
  });

  it('accepts defaultPipelineId from the same project, then clears it with null', async () => {
    const f = await makeFixture(db, 'pipe-same');
    try {
      const [p] = await db
        .insert(pipeline)
        .values({ projectId: f.projRow.id, name: `${stamp('p')}` })
        .returning();

      await caller.project.update({
        id: f.projRow.id,
        defaultPipelineId: p.id,
      });
      const after1 = await caller.project.getById({ id: f.projRow.id });
      expect(after1?.defaultPipelineId).toBe(p.id);

      await caller.project.update({
        id: f.projRow.id,
        defaultPipelineId: null,
      });
      const after2 = await caller.project.getById({ id: f.projRow.id });
      expect(after2?.defaultPipelineId).toBeNull();
    } finally {
      await teardown(db, {
        orgId: f.org.id,
        userId: f.userRow.id,
        projectId: f.projRow.id,
      });
    }
  });

  it('rejects brandId from a different org', async () => {
    const fA = await makeFixture(db, 'brand-cross-a');
    const fB = await makeFixture(db, 'brand-cross-b');
    try {
      const [otherBrand] = await db
        .insert(brand)
        .values({ orgId: fB.org.id, name: `${stamp('b')}` })
        .returning();

      await expect(
        caller.project.update({
          id: fA.projRow.id,
          brandId: otherBrand.id,
        })
      ).rejects.toMatchObject({ message: 'BRAND_NOT_IN_ORG' });
    } finally {
      await teardown(db, {
        orgId: fA.org.id,
        userId: fA.userRow.id,
        projectId: fA.projRow.id,
      });
      await teardown(db, {
        orgId: fB.org.id,
        userId: fB.userRow.id,
        projectId: fB.projRow.id,
      });
    }
  });

  it('accepts brandId from the same org', async () => {
    const f = await makeFixture(db, 'brand-same');
    try {
      const [b] = await db
        .insert(brand)
        .values({ orgId: f.org.id, name: `${stamp('b')}` })
        .returning();

      await caller.project.update({
        id: f.projRow.id,
        brandId: b.id,
      });
      const after = await caller.project.getById({ id: f.projRow.id });
      expect(after?.brandId).toBe(b.id);
    } finally {
      await teardown(db, {
        orgId: f.org.id,
        userId: f.userRow.id,
        projectId: f.projRow.id,
      });
    }
  });
});
