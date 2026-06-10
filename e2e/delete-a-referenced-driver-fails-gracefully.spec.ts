// e2e/delete-a-referenced-driver-fails-gracefully.spec.ts
// FLX-63 — Driver delete (referenced): attempt to delete the seeded
// "Claude Code" driver, which is referenced by every pipeline_stage.
// The FK guard in driver.delete should reject with a "referenced by N"
// error and the row should remain in the list.

import { resetDb } from './helpers/reset-db';
import { expect, gotoSettings, test } from './helpers/setup';

test.describe('@flx-63 @journey @driver-delete', () => {
  // The precondition ("Claude Code" referenced by every pipeline_stage) is
  // seed state. Earlier daemon-fixture specs rewire the seed pipeline's
  // stages to stub drivers, so re-assert the precondition with a reset
  // (FLX-266).
  test.beforeAll(async () => {
    await resetDb();
  });

  test('delete-a-referenced-driver-fails-gracefully', async ({ page }) => {
    await gotoSettings(page, 'drivers');

    // Seeded driver: "Claude Code" (slug claude-code) — referenced by all
    // seeded pipeline_stage rows.
    const row = page.locator('li', { hasText: 'Claude Code' });
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, Delete' }).click();

    // RecordEditor surfaces the thrown error in its banner.
    await expect(page.getByText(/referenced by/i)).toBeVisible({
      timeout: 10_000,
    });

    // Row still present.
    await expect(page.locator('li', { hasText: 'Claude Code' })).toBeVisible();
  });
});
