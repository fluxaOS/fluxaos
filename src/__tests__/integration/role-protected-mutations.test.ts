// src/__tests__/integration/role-protected-mutations.test.ts
// FLX-12 — protectedMutation rejects mutations from viewer-role contexts
// and accepts admin-role contexts. Captures the server-side enforcement
// contract for skill / driver / user routers. Not CI-gated (vitest was
// dropped from CI per FLX-57); tests live here as a regression-snapshot
// to be run locally when role logic changes.

import 'dotenv/config';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { driver, skill } from '@/core/db/schema';
import type { Role } from '@/core/features/roles';
import { appRouter } from '@/server/root';
import type { TRPCContext } from '@/server/trpc';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set');
const provider = new SupabaseDatabaseProvider(url);
const db = provider.getConnection();

const cleanup = {
  driverIds: [] as string[],
  skillIds: [] as string[],
};

afterAll(async () => {
  for (const id of cleanup.driverIds) {
    await db.delete(driver).where(eq(driver.id, id));
  }
  for (const id of cleanup.skillIds) {
    await db.delete(skill).where(eq(skill.id, id));
  }
  await provider.close();
});

function ctxFor(role: Role): TRPCContext {
  return {
    db,
    viewer: { authUserId: null, fluxaUserId: null, role },
  };
}

describe('FLX-12 protectedMutation enforcement', () => {
  let driverId = '';
  let driverVersion = 1;
  let skillId = '';
  let skillVersion = 1;

  beforeAll(async () => {
    const stamp = Date.now();
    const [d] = await db
      .insert(driver)
      .values({
        name: `flx-12-${stamp}`,
        slug: `flx-12-${stamp}`,
        binary: 'echo',
        contextLayout: { instructionsFile: 'TEST.md' },
      })
      .returning();
    driverId = d.id;
    driverVersion = d.version;
    cleanup.driverIds.push(driverId);

    const [s] = await db
      .insert(skill)
      .values({
        scope: 'global',
        name: `flx-12-skill-${stamp}`,
      })
      .returning();
    skillId = s.id;
    skillVersion = s.version ?? 1;
    cleanup.skillIds.push(skillId);
  });

  it('viewer cannot update driver', async () => {
    const caller = appRouter.createCaller(ctxFor('viewer'));
    await expect(
      caller.driver.update({
        id: driverId,
        version: driverVersion,
        notes: 'should be rejected',
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('viewer cannot delete driver', async () => {
    const caller = appRouter.createCaller(ctxFor('viewer'));
    await expect(
      caller.driver.delete({ id: driverId, version: driverVersion })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('viewer cannot update skill', async () => {
    const caller = appRouter.createCaller(ctxFor('viewer'));
    await expect(
      caller.skill.update({
        id: skillId,
        version: skillVersion,
        name: 'rejected',
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('maintainer cannot delete skill (delete requires admin)', async () => {
    const caller = appRouter.createCaller(ctxFor('maintainer'));
    await expect(
      caller.skill.delete({ id: skillId, version: skillVersion })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('maintainer can update skill', async () => {
    const caller = appRouter.createCaller(ctxFor('maintainer'));
    const updated = await caller.skill.update({
      id: skillId,
      version: skillVersion,
      description: 'maintainer-edit',
    });
    expect(updated.description).toBe('maintainer-edit');
    skillVersion = updated.version ?? skillVersion + 1;
  });

  it('admin can delete skill', async () => {
    const caller = appRouter.createCaller(ctxFor('admin'));
    const result = await caller.skill.delete({
      id: skillId,
      version: skillVersion,
    });
    expect(result.id).toBe(skillId);
    cleanup.skillIds = cleanup.skillIds.filter((id) => id !== skillId);
  });

  it('FORBIDDEN error messages mention required role', async () => {
    const caller = appRouter.createCaller(ctxFor('viewer'));
    try {
      await caller.driver.update({
        id: driverId,
        version: driverVersion,
        notes: 'x',
      });
      throw new Error('expected FORBIDDEN');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).message).toMatch(/admin|maintainer/);
    }
  });
});
