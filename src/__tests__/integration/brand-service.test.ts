import 'dotenv/config';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import { brand, organization, project, team, user } from '@/core/db/schema';
import { resolveStageBrand } from '@/core/orchestrator/brand-resolver';
import { createBrandService } from '@/core/services';
import { resolveProjectScopeContext } from '@/core/services/resolve-scoped';
import { appRouter } from '@/server/root';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set for integration tests');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();

const RUN = Date.now().toString(36);
let fixtureCount = 0;
const cleanup: {
  table: 'brand' | 'project' | 'user' | 'organization';
  id: string;
}[] = [];

async function seedOrgUserProject() {
  fixtureCount += 1;
  const stamp = `${RUN}-${fixtureCount}`;
  const [org] = await db
    .insert(organization)
    .values({ name: `brand-org-${stamp}`, slug: `brand-org-${stamp}` })
    .returning();
  cleanup.push({ table: 'organization', id: org.id });

  const [usr] = await db
    .insert(user)
    .values({
      orgId: org.id,
      email: `brand-${stamp}@example.com`,
      name: `Brand User ${stamp}`,
      slug: `brand-user-${stamp}`,
    })
    .returning();
  cleanup.push({ table: 'user', id: usr.id });

  const [teamRow] = await db
    .insert(team)
    .values({ orgId: org.id, name: `Brand Team ${stamp}` })
    .returning();

  const [proj] = await db
    .insert(project)
    .values({
      orgId: org.id,
      teamId: teamRow.id,
      name: `Brand Project ${stamp}`,
      slug: `brand-project-${stamp}`,
    })
    .returning();
  cleanup.push({ table: 'project', id: proj.id });

  return { org, usr, proj };
}

function removeCleanup(table: (typeof cleanup)[number]['table'], id: string) {
  const index = cleanup.findIndex(
    (item) => item.table === table && item.id === id
  );
  if (index >= 0) cleanup.splice(index, 1);
}

afterAll(async () => {
  for (const item of cleanup.reverse()) {
    if (item.table === 'brand') {
      await db.delete(brand).where(eq(brand.id, item.id));
    }
    if (item.table === 'project') {
      await db.delete(project).where(eq(project.id, item.id));
    }
    if (item.table === 'user') {
      await db.delete(user).where(eq(user.id, item.id));
    }
    if (item.table === 'organization') {
      await db.delete(organization).where(eq(organization.id, item.id));
    }
  }
});

describe('brand service', () => {
  it('lists org brands and project-visible brands', async () => {
    const { org, proj } = await seedOrgUserProject();
    const svc = createBrandService(db);

    const orgBrand = await svc.create({
      orgId: org.id,
      name: `Org Brand ${RUN}`,
      toneOfVoice: 'Direct and concrete',
      styleGuide: 'Use short paragraphs.',
    });
    cleanup.push({ table: 'brand', id: orgBrand.id });

    const projectBrand = await svc.create({
      orgId: org.id,
      projectId: proj.id,
      name: `Project Brand ${RUN}`,
      toneOfVoice: 'Operational and precise',
      styleGuide: 'Lead with outcomes.',
    });
    cleanup.push({ table: 'brand', id: projectBrand.id });

    const byOrg = await svc.listByOrg(org.id);
    expect(byOrg.map((row) => row.id)).toEqual(
      expect.arrayContaining([orgBrand.id, projectBrand.id])
    );

    const visible = await svc.listVisibleToProject(org.id, proj.id);
    expect(visible.map((row) => row.id)).toEqual(
      expect.arrayContaining([orgBrand.id, projectBrand.id])
    );
  });
});

describe('brand router', () => {
  it('creates, updates, lists, and deletes a brand through tRPC', async () => {
    const { org, proj } = await seedOrgUserProject();
    const caller = appRouter.createCaller({
      db,
      viewer: {
        authUserId: null,
        fluxaUserId: null,
        role: 'admin',
        tier: 'enterprise',
      },
    });

    const created = await caller.brand.create({
      orgId: org.id,
      projectId: proj.id,
      name: `Router Brand ${RUN}`,
      toneOfVoice: 'Router tone',
      styleGuide: 'Router style',
      colors: { primary: '#5B21B6' },
      fonts: { sans: 'Inter' },
      logoUrl: null,
    });
    cleanup.push({ table: 'brand', id: created.id });

    const updated = await caller.brand.update({
      id: created.id,
      version: created.version,
      name: `Router Brand Updated ${RUN}`,
      toneOfVoice: 'Updated router tone',
      styleGuide: 'Updated router style',
    });

    expect(updated?.name).toBe(`Router Brand Updated ${RUN}`);
    expect(updated?.toneOfVoice).toBe('Updated router tone');

    const visible = await caller.brand.listVisibleToProject({
      orgId: org.id,
      projectId: proj.id,
    });
    expect(visible.map((row) => row.id)).toContain(created.id);

    const updatedProject = await caller.project.update({
      id: proj.id,
      brandId: created.id,
    });
    expect(updatedProject?.brandId).toBe(created.id);

    const deleted = await caller.brand.delete({
      id: created.id,
      version: updated.version,
    });
    expect(deleted).toEqual({ id: created.id });
    removeCleanup('brand', created.id);
  });
});

describe('stage brand resolver', () => {
  it('prefers persona brand over project brand', async () => {
    const { org, proj } = await seedOrgUserProject();
    const svc = createBrandService(db);
    const projectBrand = await svc.create({
      orgId: org.id,
      projectId: proj.id,
      name: `Project Runtime Brand ${RUN}`,
      toneOfVoice: 'Project tone',
    });
    cleanup.push({ table: 'brand', id: projectBrand.id });
    const personaBrand = await svc.create({
      orgId: org.id,
      name: `Persona Runtime Brand ${RUN}`,
      toneOfVoice: 'Persona tone',
    });
    cleanup.push({ table: 'brand', id: personaBrand.id });

    const scope = await resolveProjectScopeContext(db, proj.id);
    const resolved = await resolveStageBrand(db, scope, {
      personaBrandId: personaBrand.id,
      projectBrandId: projectBrand.id,
    });

    expect(resolved?.id).toBe(personaBrand.id);
    expect(resolved?.toneOfVoice).toBe('Persona tone');
  });

  it('uses project brand when persona brand is not set', async () => {
    const { org, proj } = await seedOrgUserProject();
    const svc = createBrandService(db);
    const projectBrand = await svc.create({
      orgId: org.id,
      projectId: proj.id,
      name: `Fallback Runtime Brand ${RUN}`,
      toneOfVoice: 'Project fallback tone',
    });
    cleanup.push({ table: 'brand', id: projectBrand.id });

    const scope = await resolveProjectScopeContext(db, proj.id);
    const resolved = await resolveStageBrand(db, scope, {
      personaBrandId: null,
      projectBrandId: projectBrand.id,
    });

    expect(resolved?.id).toBe(projectBrand.id);
  });

  it('returns null when no brand is configured', async () => {
    const resolved = await resolveStageBrand(db, {}, {
      personaBrandId: null,
      projectBrandId: null,
    });

    expect(resolved).toBeNull();
  });
});
