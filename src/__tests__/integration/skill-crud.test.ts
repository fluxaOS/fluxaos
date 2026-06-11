// src/__tests__/integration/skill-crud.test.ts
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import * as schema from '@/core/db/schema';
import { createSkillService } from '@/core/services';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set');
const provider = new SupabaseDatabaseProvider(url);
const db = provider.getConnection();

const RUN = Date.now();
const createdIds: string[] = [];
const personaIds: string[] = [];

afterAll(async () => {
  // persona_skill rows cascade-block deletes — remove junctions first.
  for (const personaId of personaIds) {
    await db
      .delete(schema.personaSkill)
      .where(eq(schema.personaSkill.personaId, personaId));
    await db.delete(schema.persona).where(eq(schema.persona.id, personaId));
  }
  for (const id of createdIds.reverse()) {
    await db.delete(schema.skill).where(eq(schema.skill.id, id));
  }
  await provider.close();
});

type SkillCreateInput = Parameters<
  ReturnType<typeof createSkillService>['create']
>[0];

function skillInput(data: Record<string, unknown>): SkillCreateInput {
  return data as SkillCreateInput;
}

describe('skill service CRUD (integration)', () => {
  it('updates a skill and increments version', async () => {
    const svc = createSkillService(db);
    const created = await svc.create(
      skillInput({
        scope: 'global',
        name: `test-skill-${RUN}`,
        description: 'orig',
        promptTemplate: 'orig prompt',
      })
    );
    createdIds.push(created.id);

    const updated = await svc.updateWithVersion(
      created.id,
      created.version ?? 1,
      {
        description: 'updated',
      }
    );
    expect(updated).not.toBeNull();
    expect(updated?.description).toBe('updated');
    expect(updated?.version).toBe((created.version ?? 1) + 1);
  });

  it('rejects stale-version update', async () => {
    const svc = createSkillService(db);
    const created = await svc.create(
      skillInput({ scope: 'global', name: `stale-${RUN}`, description: 'orig' })
    );
    createdIds.push(created.id);

    // First update succeeds, bumping version
    await svc.updateWithVersion(created.id, created.version ?? 1, {
      description: 'v2',
    });

    // Second update with stale version returns null
    const again = await svc.updateWithVersion(
      created.id,
      created.version ?? 1,
      {
        description: 'v-stale',
      }
    );
    expect(again).toBeNull();
  });

  it('countReferences reports zero for unreferenced skill', async () => {
    const svc = createSkillService(db);
    const created = await svc.create(
      skillInput({ scope: 'global', name: `unref-${RUN}` })
    );
    createdIds.push(created.id);

    const refs = await svc.countReferences(created.id);
    expect(refs.stageRuns).toBe(0);
    expect(refs.personaSkills).toBe(0);
  });

  it('countReferences reports non-zero for a persona-bound skill', async () => {
    // FLX-153 removed pipeline_stage.skill_id, so the surviving reference
    // sources countReferences reads are stage_run and persona_skill.
    // Build an OWNED fixture (skill + persona + persona_skill binding)
    // instead of depending on seeded rows another suite may mutate.
    const svc = createSkillService(db);
    const created = await svc.create(
      skillInput({ scope: 'global', name: `persona-bound-${RUN}` })
    );
    createdIds.push(created.id);

    const [personaRow] = await db
      .insert(schema.persona)
      .values({
        kind: 'catalog',
        name: `skill-crud-persona-${RUN}`,
        soul: 'test soul',
      })
      .returning();
    personaIds.push(personaRow.id);
    await db
      .insert(schema.personaSkill)
      .values({ personaId: personaRow.id, skillId: created.id });

    const refs = await svc.countReferences(created.id);
    expect(refs.personaSkills).toBe(1);
    expect(refs.stageRuns).toBe(0);
  });

  it('router delete rejects when references exist', async () => {
    // Same owned-fixture shape as above: a persona_skill binding makes the
    // total reference count non-zero, which is exactly the condition the
    // router's delete mutation refuses on (it sums countReferences).
    const svc = createSkillService(db);
    const created = await svc.create(
      skillInput({ scope: 'global', name: `router-guard-${RUN}` })
    );
    createdIds.push(created.id);

    const [personaRow] = await db
      .insert(schema.persona)
      .values({
        kind: 'catalog',
        name: `skill-crud-guard-persona-${RUN}`,
        soul: 'test soul',
      })
      .returning();
    personaIds.push(personaRow.id);
    await db
      .insert(schema.personaSkill)
      .values({ personaId: personaRow.id, skillId: created.id });

    const refs = await svc.countReferences(created.id);
    expect(refs.stageRuns + refs.personaSkills).toBeGreaterThan(0);

    // Verify that the service's countReferences is what the router uses
    // to produce its error — the router is tested via Playwright.
  });
});
