// src/__tests__/integration/feature-gated-tier.test.ts
// FLX-14 — featureGated rejects requests from free-tier contexts and
// accepts pro/enterprise. Captures the server-side paywall contract.
// Not CI-gated (vitest dropped from CI per FLX-57); regression snapshot
// for local runs when tier logic changes.

import 'dotenv/config';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import { driver, skill } from '@/core/db/schema';
import type { Tier } from '@/core/features/tiers';
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

function ctxFor(tier: Tier): TRPCContext {
  return {
    db,
    viewer: {
      authUserId: null,
      fluxaUserId: null,
      role: 'admin',
      tier,
    },
  };
}

describe('FLX-14 featureGated enforcement', () => {
  let driverId = '';
  let skillId = '';

  beforeAll(async () => {
    const stamp = Date.now();
    const [d] = await db
      .insert(driver)
      .values({
        name: `flx-14-${stamp}`,
        slug: `flx-14-${stamp}`,
        binary: 'echo',
        contextLayout: { instructionsFile: 'TEST.md' },
      })
      .returning();
    driverId = d.id;
    cleanup.driverIds.push(driverId);

    const [s] = await db
      .insert(skill)
      .values({
        scope: 'global',
        name: `flx-14-skill-${stamp}`,
      })
      .returning();
    skillId = s.id;
    cleanup.skillIds.push(skillId);
  });

  it('free tier cannot listHistory on driver', async () => {
    const caller = appRouter.createCaller(ctxFor('free'));
    await expect(
      caller.driver.listHistory({ id: driverId })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('free tier cannot listHistory on skill', async () => {
    const caller = appRouter.createCaller(ctxFor('free'));
    await expect(
      caller.skill.listHistory({ id: skillId })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('pro tier can listHistory on driver', async () => {
    const caller = appRouter.createCaller(ctxFor('pro'));
    const rows = await caller.driver.listHistory({ id: driverId });
    expect(Array.isArray(rows)).toBe(true);
  });

  it('enterprise tier can listHistory on skill', async () => {
    const caller = appRouter.createCaller(ctxFor('enterprise'));
    const rows = await caller.skill.listHistory({ id: skillId });
    expect(Array.isArray(rows)).toBe(true);
  });

  it('FORBIDDEN error mentions tier', async () => {
    const caller = appRouter.createCaller(ctxFor('free'));
    try {
      await caller.driver.listHistory({ id: driverId });
      throw new Error('expected FORBIDDEN');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).message).toMatch(/tier/);
    }
  });
});
