// e2e/driver-revisions.spec.ts
// FLX-91 — Driver revision history + revert journey.

import 'dotenv/config';
import { resetDb } from './helpers/reset-db';
import { expect, gotoSettings, test } from './helpers/setup';

test.describe('@flx-91 @settings @drivers @revisions', () => {
  // Reset DB so revision_number assertions are deterministic.
  test.beforeAll(async () => {
    await resetDb();
  });

  test('driver edit creates revision; revert restores prior content', async ({
    page,
  }) => {
    await gotoSettings(page, 'drivers');

    // Pick the seeded "claude" driver.
    const claudeRow = page.locator('li', { hasText: 'Claude Code' }).first();
    await expect(claudeRow).toBeVisible({ timeout: 15_000 });
    await claudeRow.click();

    // First edit — change Notes, save. Snapshot becomes revision #1.
    await page.getByRole('button', { name: 'Edit' }).click();

    const notesField = page
      .locator('label', { hasText: 'Notes' })
      .locator('..')
      .locator('textarea');

    const stamp = Date.now();
    const firstEdit = `flx-91 first edit ${stamp}`;
    await notesField.fill(firstEdit);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

    const historyCard = page.getByTestId('driver-revision-history');
    await expect(historyCard).toBeVisible();
    await expect(historyCard.getByTestId('driver-revision-row-1')).toBeVisible({
      timeout: 10_000,
    });

    // Second edit — change Notes again, save. Revision #2.
    await page.getByRole('button', { name: 'Edit' }).click();
    const secondEdit = `flx-91 second edit ${stamp}`;
    await notesField.fill(secondEdit);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

    await expect(
      historyCard.getByTestId('driver-revision-row-2')
    ).toBeVisible();

    // Reload — Notes persists as second edit.
    await page.reload();
    await page.locator('li', { hasText: 'Claude Code' }).first().click();
    await expect(page.getByText(secondEdit).first()).toBeVisible();

    // Revert to revision #1.
    const historyCardAfter = page.getByTestId('driver-revision-history');
    await expect(historyCardAfter).toBeVisible();
    await historyCardAfter
      .getByTestId('driver-revision-row-1')
      .getByRole('button', { name: /Revert/ })
      .click();

    // Notes reverts to firstEdit and a new revision #3 captures the
    // reverted state.
    await expect(page.getByText(firstEdit).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      historyCardAfter.getByTestId('driver-revision-row-3')
    ).toBeVisible();
  });
});
