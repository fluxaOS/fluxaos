// src/__tests__/integration/skill-crud.test.ts
import 'dotenv/config';
import { describe, expect, it, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { createSkillService } from '@/core/services';
import * as schema from '@/core/db/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set');
const provider = new SupabaseDatabaseProvider(url);
const db = provider.getConnection();

const RUN = Date.now();
const createdIds: string[] = [];

afterAll(async () => {
  for (const id of createdIds.reverse()) {
    await db.delete(schema.skill).where(eq(schema.skill.id, id));
  }
  await provider.close();
});

type SkillCreateInput = Parameters<ReturnType<typeof createSkillService>['create']>[0];

function skillInput(data: Record<string, unknown>): SkillCreateInput {
  return data as SkillCreateInput;
}

describe('skill service CRUD (integration)', () => {
  it('updates a skill and increments version', async () => {
    const svc = createSkillService(db);
    const created = await svc.create(
      skillInput({ scope: 'global', name: `test-skill-${RUN}`, description: 'orig', promptTemplate: 'orig prompt' }),
    );
    createdIds.push(created.id);

    const updated = await svc.updateWithVersion(created.id, created.version ?? 1, {
      description: 'updated',
    });
    expect(updated).not.toBeNull();
    expect(updated!.description).toBe('updated');
    expect(updated!.version).toBe((created.version ?? 1) + 1);
  });

  it('rejects stale-version update', async () => {
    const svc = createSkillService(db);
    const created = await svc.create(
      skillInput({ scope: 'global', name: `stale-${RUN}`, description: 'orig' }),
    );
    createdIds.push(created.id);

    // First update succeeds, bumping version
    await svc.updateWithVersion(created.id, created.version ?? 1, { description: 'v2' });

    // Second update with stale version returns null
    const again = await svc.updateWithVersion(created.id, created.version ?? 1, {
      description: 'v-stale',
    });
    expect(again).toBeNull();
  });

  it('countReferences reports zero for unreferenced skill', async () => {
    const svc = createSkillService(db);
    const created = await svc.create(
      skillInput({ scope: 'global', name: `unref-${RUN}` }),
    );
    createdIds.push(created.id);

    const refs = await svc.countReferences(created.id);
    expect(refs.pipelineStages).toBe(0);
    expect(refs.stageRuns).toBe(0);
    expect(refs.personaSkills).toBe(0);
  });

  it('countReferences reports non-zero for seeded skill', async () => {
    // The "research" skill is seeded AND referenced by a pipeline_stage
    const [research] = await db
      .select()
      .from(schema.skill)
      .where(eq(schema.skill.name, 'research'));

    if (!research) {
      // Not seeded in this DB — skip
      return;
    }
    const svc = createSkillService(db);
    const refs = await svc.countReferences(research.id);
    expect(refs.pipelineStages).toBeGreaterThan(0);
  });
});
