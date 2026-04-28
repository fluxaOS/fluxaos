// e2e/feature-gated-tier.spec.ts
// FLX-14 — flipping the org's subscription_tier to 'free' hides the
// revision-history panel on the skill settings page; flipping back to
// 'enterprise' restores it. Verifies the client-side
// useHasFeature(REVISION_HISTORY) gate end-to-end.
//
// Server-side enforcement (featureGated on listHistory) has its own
// integration coverage in src/__tests__/integration/feature-gated-tier.test.ts.

import 'dotenv/config';
import { execSync } from 'node:child_process';
import path from 'node:path';
import postgres from 'postgres';
import { expect, projectPath, test } from './helpers/setup';

const DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const HAS_DB = !!DATABASE_URL;
const REPO_ROOT = path.resolve(__dirname, '..');

test.describe('@flx-14 @journey @tier-gate', () => {
  test.skip(!HAS_DB, 'requires DATABASE_URL or DIRECT_URL');
  test.setTimeout(90_000);

  test.beforeAll(() => {
    execSync('npx tsx src/scripts/db/nuke.ts', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    execSync('npm run db:seed', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    });
  });

  test('flipping org tier to free hides the revision-history panel', async ({
    page,
  }) => {
    const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
    try {
      // Sanity: the seeded org is on 'enterprise' (grandfathered by 0017),
      // so the panel renders by default.
      await page.goto(projectPath('/settings/skills'));
      const researchRow = page.locator('li', { hasText: 'research' }).first();
      await expect(researchRow).toBeVisible({ timeout: 15_000 });
      await researchRow.click();
      await expect(page.getByTestId('skill-revision-history')).toBeVisible();

      // Flip the seeded org to 'free' tier directly via SQL — there is no
      // UI for tier changes today (billing webhook would do this in prod).
      await sql`UPDATE "organization" SET subscription_tier = 'free'`;

      // Reload — useViewerTier refetches, useHasFeature flips false, the
      // revision history panel disappears.
      await page.reload();
      await page.locator('li', { hasText: 'research' }).first().click();
      await expect(page.getByTestId('skill-revision-history')).toHaveCount(0, {
        timeout: 10_000,
      });

      // Restore enterprise tier so the rest of the suite (which assumes
      // grandfathered behavior) keeps working.
      await sql`UPDATE "organization" SET subscription_tier = 'enterprise'`;
    } finally {
      await sql.end();
    }
  });
});
