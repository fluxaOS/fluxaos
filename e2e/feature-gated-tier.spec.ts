// e2e/feature-gated-tier.spec.ts
// FLX-14 — useHasFeature(REVISION_HISTORY) gates the revision-history panel
// on the skill settings page.
//
// FLX-239 Stage 7 (FLX-266): rewritten for the LAN auth bypass the suite
// runs under. With FLUXAOS_LAN_AUTH_BYPASS=1 the viewer tier is PINNED to
// 'enterprise' in resolveViewer (src/server/trpc.ts) — the org row's
// subscription_tier is never consulted — so "flip the org to free and watch
// the panel disappear" is untestable through this surface (the old version
// of this spec only ever passed by racing the panel's render). What IS the
// e2e contract here:
//   1. the enterprise-tier viewer sees the revision-history panel, and
//   2. the bypass viewer's tier is pinned — org tier flips do NOT change
//      what the operator sees (deterministic homelab behavior).
// Tier-driven gate enforcement (free hides/rejects) has real coverage in
// src/__tests__/integration/feature-gated-tier.test.ts.

import 'dotenv/config';
import postgres from 'postgres';
import { resetDb } from './helpers/reset-db';
import { expect, projectPath, test } from './helpers/setup';

const DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const HAS_DB = !!DATABASE_URL;

test.describe('@flx-14 @journey @tier-gate', () => {
  test.skip(!HAS_DB, 'requires DATABASE_URL or DIRECT_URL');
  test.setTimeout(90_000);

  test.beforeAll(async () => {
    await resetDb();
  });

  test('enterprise viewer sees revision history; LAN-bypass tier is pinned across org tier flips', async ({
    page,
  }) => {
    const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
    try {
      // The seeded org is on 'enterprise' (grandfathered by 0017) and the
      // bypass viewer is enterprise — the panel renders.
      await page.goto(projectPath('/settings/skills'));
      const researchRow = page.locator('li', { hasText: 'research' }).first();
      await expect(researchRow).toBeVisible({ timeout: 15_000 });
      await researchRow.click();
      await expect(page.getByTestId('skill-revision-history')).toBeVisible({
        timeout: 10_000,
      });

      // Flip the org row to 'free' via SQL (no UI for tier changes today).
      await sql`UPDATE "organization" SET subscription_tier = 'free'`;

      // Reload — the bypass viewer's tier is pinned to enterprise, so the
      // panel must STILL render. (If bypass ever starts resolving tier from
      // the org row, this assertion flips and the spec must be updated
      // alongside that intentional change.)
      await page.reload();
      const rowAfter = page.locator('li', { hasText: 'research' }).first();
      await expect(rowAfter).toBeVisible({ timeout: 15_000 });
      await rowAfter.click();
      await expect(page.getByTestId('skill-revision-history')).toBeVisible({
        timeout: 10_000,
      });

      // Restore enterprise tier so the org row matches seed expectations.
      await sql`UPDATE "organization" SET subscription_tier = 'enterprise'`;
    } finally {
      await sql.end();
    }
  });
});
