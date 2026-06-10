import 'dotenv/config';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import {
  brand,
  driver,
  organization,
  persona,
  project,
  team,
  user,
} from '@/core/db/schema';
import { resolveStageBrand } from '@/core/orchestrator/brand-resolver';
import { createBrandService, createPersonaService } from '@/core/services';
import {
  resolveScoped,
  resolveScopedAll,
} from '@/core/services/resolve-scoped';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

const createdDriverIds: string[] = [];
const createdPersonaIds: string[] = [];
const createdBrandIds: string[] = [];
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
  const [org] = await db.insert(organization).values({ name: s }).returning();
  createdOrgIds.push(org.id);

  const [teamRow] = await db
    .insert(team)
    .values({ orgId: org.id, name: s })
    .returning();
  createdTeamIds.push(teamRow.id);

  const [userRow] = await db
    .insert(user)
    .values({ orgId: org.id, email: `${s}@test.local`, name: s })
    .returning();
  createdUserIds.push(userRow.id);

  const [projectRow] = await db
    .insert(project)
    .values({
      orgId: org.id,
      teamId: teamRow.id,
      name: s,
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

async function insertPersona(
  layer: ScopeLayer,
  ctx: Awaited<ReturnType<typeof makeScopeFixture>>,
  name = stamp('persona'),
  soul = `${layer} soul`
) {
  const [row] = await db
    .insert(persona)
    .values({
      name,
      soul,
      kind: layer,
      orgId: layer === 'org' ? ctx.orgId : null,
      teamId: layer === 'team' ? ctx.teamId : null,
      userId: layer === 'user' ? ctx.userId : null,
      projectId: layer === 'project' ? ctx.projectId : null,
    })
    .returning();
  createdPersonaIds.push(row.id);
  return row;
}

async function insertBrand(
  layer: ScopeLayer,
  ctx: Awaited<ReturnType<typeof makeScopeFixture>>,
  name = stamp('brand'),
  toneOfVoice = `${layer} tone`
) {
  const [row] = await db
    .insert(brand)
    .values({
      name,
      toneOfVoice,
      kind: layer,
      orgId: layer === 'org' ? ctx.orgId : null,
      teamId: layer === 'team' ? ctx.teamId : null,
      userId: layer === 'user' ? ctx.userId : null,
      projectId: layer === 'project' ? ctx.projectId : null,
    })
    .returning();
  createdBrandIds.push(row.id);
  return row;
}

beforeEach(async () => {
  createdDriverIds.length = 0;
  createdPersonaIds.length = 0;
  createdBrandIds.length = 0;
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
  if (createdPersonaIds.length) {
    await db.delete(persona).where(inArray(persona.id, [...createdPersonaIds]));
  }
  if (createdBrandIds.length) {
    await db.delete(brand).where(inArray(brand.id, [...createdBrandIds]));
  }
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
  createdPersonaIds.length = 0;
  createdBrandIds.length = 0;
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

describe('feature consumers', () => {
  it('persona effective list prefers org over catalog', async () => {
    const ctx = await makeScopeFixture();
    const name = stamp('persona-org');
    try {
      await insertPersona('catalog', ctx, name, 'catalog persona');
      const orgPersona = await insertPersona('org', ctx, name, 'org persona');

      const resolved = await createPersonaService(db).listEffective(ctx);

      expect(resolved.find((row) => row.name === name)?.id).toBe(orgPersona.id);
      expect(resolved.find((row) => row.name === name)?.soul).toBe(
        'org persona'
      );
    } finally {
      await cleanup();
    }
  });

  it('persona effective list prefers project over org', async () => {
    const ctx = await makeScopeFixture();
    const name = stamp('persona-project');
    try {
      await insertPersona('org', ctx, name, 'org persona');
      const projectPersona = await insertPersona(
        'project',
        ctx,
        name,
        'project persona'
      );

      const resolved = await createPersonaService(db).listEffective(ctx);

      expect(resolved.find((row) => row.name === name)?.id).toBe(
        projectPersona.id
      );
      expect(resolved.find((row) => row.name === name)?.soul).toBe(
        'project persona'
      );
    } finally {
      await cleanup();
    }
  });

  it('brand effective list prefers org over catalog', async () => {
    const ctx = await makeScopeFixture();
    const name = stamp('brand-org');
    try {
      await insertBrand('catalog', ctx, name, 'catalog tone');
      const orgBrand = await insertBrand('org', ctx, name, 'org tone');

      const resolved = await createBrandService(db).listEffective(ctx);

      expect(resolved.find((row) => row.name === name)?.id).toBe(orgBrand.id);
      expect(resolved.find((row) => row.name === name)?.toneOfVoice).toBe(
        'org tone'
      );
    } finally {
      await cleanup();
    }
  });

  it('brand effective list prefers project over org', async () => {
    const ctx = await makeScopeFixture();
    const name = stamp('brand-project');
    try {
      await insertBrand('org', ctx, name, 'org tone');
      const projectBrand = await insertBrand(
        'project',
        ctx,
        name,
        'project tone'
      );

      const resolved = await createBrandService(db).listEffective(ctx);

      expect(resolved.find((row) => row.name === name)?.id).toBe(
        projectBrand.id
      );
      expect(resolved.find((row) => row.name === name)?.toneOfVoice).toBe(
        'project tone'
      );
    } finally {
      await cleanup();
    }
  });

  it('runtime selectors resolve configured catalog rows to project overrides by name', async () => {
    const ctx = await makeScopeFixture();
    const personaName = stamp('runtime-persona');
    const brandName = stamp('runtime-brand');
    try {
      const catalogPersona = await insertPersona(
        'catalog',
        ctx,
        personaName,
        'catalog runtime persona'
      );
      const projectPersona = await insertPersona(
        'project',
        ctx,
        personaName,
        'project runtime persona'
      );
      const catalogBrand = await insertBrand(
        'catalog',
        ctx,
        brandName,
        'catalog runtime tone'
      );
      const projectBrand = await insertBrand(
        'project',
        ctx,
        brandName,
        'project runtime tone'
      );

      const resolvedPersona = await createPersonaService(
        db
      ).resolveEffectiveById(catalogPersona.id, ctx);
      const resolvedBrand = await resolveStageBrand(db, ctx, {
        personaBrandId: catalogBrand.id,
        projectBrandId: null,
      });

      expect(resolvedPersona?.id).toBe(projectPersona.id);
      expect(resolvedPersona?.soul).toBe('project runtime persona');
      expect(resolvedBrand?.id).toBe(projectBrand.id);
      expect(resolvedBrand?.toneOfVoice).toBe('project runtime tone');
    } finally {
      await cleanup();
    }
  });
});
