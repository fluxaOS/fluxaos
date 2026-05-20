import 'dotenv/config';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import { driver, organization, project, team, user } from '@/core/db/schema';
import {
  resolveScoped,
  resolveScopedAll,
} from '@/core/services/resolve-scoped';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

const createdDriverIds: string[] = [];
const createdProjectIds: string[] = [];
const createdUserIds: string[] = [];
const createdTeamIds: string[] = [];
const createdOrgIds: string[] = [];

type ScopeLayer = 'catalog' | 'org' | 'team' | 'user' | 'project';
type DriverRow = typeof driver.$inferSelect;

const priority: ScopeLayer[] = ['project', 'user', 'team', 'org', 'catalog'];

function stamp(label: string): string {
  return `resolve-scoped-${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function makeScopeFixture() {
  const s = stamp('tenant');
  const [org] = await db
    .insert(organization)
    .values({ name: s, slug: s })
    .returning();
  createdOrgIds.push(org.id);

  const [teamRow] = await db
    .insert(team)
    .values({ orgId: org.id, name: s })
    .returning();
  createdTeamIds.push(teamRow.id);

  const [userRow] = await db
    .insert(user)
    .values({ orgId: org.id, email: `${s}@test.local`, name: s, slug: s })
    .returning();
  createdUserIds.push(userRow.id);

  const [projectRow] = await db
    .insert(project)
    .values({
      orgId: org.id,
      teamId: teamRow.id,
      name: s,
      slug: s,
      repoUrl: 'https://github.com/fluxaos/fixture',
      defaultBranch: 'main',
    })
    .returning();
  createdProjectIds.push(projectRow.id);

  return {
    orgId: org.id,
    teamId: teamRow.id,
    userId: userRow.id,
    projectId: projectRow.id,
  };
}

function scopedValues(
  layer: ScopeLayer,
  ctx: Awaited<ReturnType<typeof makeScopeFixture>>,
  name: string
) {
  return {
    name,
    slug: stamp(`${name}-${layer}`),
    binary: 'echo',
    contextLayout: { instructionsFile: 'TEST.md', contextFile: 'context.md' },
    kind: layer,
    orgId: layer === 'org' ? ctx.orgId : null,
    teamId: layer === 'team' ? ctx.teamId : null,
    userId: layer === 'user' ? ctx.userId : null,
    projectId: layer === 'project' ? ctx.projectId : null,
  };
}

async function insertDriver(
  layer: ScopeLayer,
  ctx: Awaited<ReturnType<typeof makeScopeFixture>>,
  name = stamp('driver')
) {
  const [row] = await db
    .insert(driver)
    .values(scopedValues(layer, ctx, name))
    .returning();
  createdDriverIds.push(row.id);
  return row;
}

beforeEach(async () => {
  createdDriverIds.length = 0;
  createdProjectIds.length = 0;
  createdUserIds.length = 0;
  createdTeamIds.length = 0;
  createdOrgIds.length = 0;
});

afterAll(async () => {
  await cleanup();
  await provider.close();
});

async function cleanup() {
  if (createdDriverIds.length) {
    await db.delete(driver).where(inArray(driver.id, [...createdDriverIds]));
  }
  if (createdProjectIds.length) {
    await db.delete(project).where(inArray(project.id, [...createdProjectIds]));
  }
  if (createdUserIds.length) {
    await db.delete(user).where(inArray(user.id, [...createdUserIds]));
  }
  if (createdTeamIds.length) {
    await db.delete(team).where(inArray(team.id, [...createdTeamIds]));
  }
  if (createdOrgIds.length) {
    await db
      .delete(organization)
      .where(inArray(organization.id, [...createdOrgIds]));
  }

  createdDriverIds.length = 0;
  createdProjectIds.length = 0;
  createdUserIds.length = 0;
  createdTeamIds.length = 0;
  createdOrgIds.length = 0;
}

describe('resolveScoped', () => {
  it.each(priority)('returns the only matching %s row', async (layer) => {
    const ctx = await makeScopeFixture();
    try {
      const row = await insertDriver(layer, ctx);

      const resolved = await resolveScoped<typeof row>(
        db,
        driver,
        ctx,
        eq(driver.name, row.name)
      );

      expect(resolved?.id).toBe(row.id);
      expect(resolved?.kind).toBe(layer);
    } finally {
      await cleanup();
    }
  });

  it('prefers project over user over team over org over catalog when all layers match', async () => {
    const ctx = await makeScopeFixture();
    const name = stamp('stack');
    try {
      for (const layer of [...priority].reverse()) {
        await insertDriver(layer, ctx, name);
      }

      const resolved = await resolveScoped<DriverRow>(
        db,
        driver,
        ctx,
        eq(driver.name, name)
      );

      expect(resolved?.kind).toBe('project');
    } finally {
      await cleanup();
    }
  });

  it('chooses the higher-priority row for every layer pair', async () => {
    for (const higher of priority) {
      for (const lower of priority.slice(priority.indexOf(higher) + 1)) {
        const ctx = await makeScopeFixture();
        const name = stamp(`${higher}-beats-${lower}`);
        try {
          await insertDriver(lower, ctx, name);
          const expected = await insertDriver(higher, ctx, name);

          const resolved = await resolveScoped<DriverRow>(
            db,
            driver,
            ctx,
            eq(driver.name, name)
          );

          expect(resolved?.id).toBe(expected.id);
          expect(resolved?.kind).toBe(higher);
        } finally {
          await cleanup();
        }
      }
    }
  }, 30_000);

  it('applies extraWhere without falling back to lower-priority non-matches', async () => {
    const ctx = await makeScopeFixture();
    const wanted = stamp('wanted');
    const other = stamp('other');
    try {
      await insertDriver('project', ctx, other);
      const expected = await insertDriver('catalog', ctx, wanted);

      const resolved = await resolveScoped<DriverRow>(
        db,
        driver,
        ctx,
        eq(driver.name, wanted)
      );

      expect(resolved?.id).toBe(expected.id);
      expect(resolved?.name).toBe(wanted);
    } finally {
      await cleanup();
    }
  });
});

describe('resolveScopedAll', () => {
  it('deduplicates by key with the highest-priority matching row winning', async () => {
    const ctx = await makeScopeFixture();
    const alpha = stamp('alpha');
    const beta = stamp('beta');
    const gamma = stamp('gamma');
    try {
      await insertDriver('catalog', ctx, alpha);
      const alphaOrg = await insertDriver('org', ctx, alpha);
      await insertDriver('team', ctx, beta);
      const betaProject = await insertDriver('project', ctx, beta);
      const gammaUser = await insertDriver('user', ctx, gamma);

      const resolved = await resolveScopedAll<DriverRow>(
        db,
        driver,
        ctx,
        'name',
        and(
          eq(driver.binary, 'echo'),
          inArray(driver.name, [alpha, beta, gamma])
        )
      );

      expect(resolved.map((row) => row.id).sort()).toEqual(
        [alphaOrg.id, betaProject.id, gammaUser.id].sort()
      );
      expect(resolved.map((row) => row.kind).sort()).toEqual(
        ['org', 'project', 'user'].sort()
      );
    } finally {
      await cleanup();
    }
  });
});
