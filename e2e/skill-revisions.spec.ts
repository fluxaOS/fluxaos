// e2e/skill-revisions.spec.ts
// FLX-13 — Skill revision history + revert journey.

import 'dotenv/config';
import { resetDb } from './helpers/reset-db';
import { expect, gotoSettings, test } from './helpers/setup';

test.describe('@flx-13 @settings @skills @revisions', () => {
  // Reset DB so revision_number assertions are deterministic.
  test.beforeAll(async () => {
    await resetDb();
  });

  test('skill edit creates revision; revert restores prior content', async ({
    page,
  }) => {
    await gotoSettings(page, 'skills');

    const researchRow = page.locator('li', { hasText: 'research' }).first();
    await expect(researchRow).toBeVisible({ timeout: 15_000 });
    await researchRow.click();

    // First edit — change description, save. Snapshot becomes revision #1
    // (the seed insert itself is not snapshotted; only updates produce
    // skill_revision rows).
    await page.getByRole('button', { name: 'Edit' }).click();

    const descField = page
      .locator('label', { hasText: 'Description' })
      .locator('..')
      .locator('textarea');

    const stamp = Date.now();
    const firstEdit = `flx-13 first edit ${stamp}`;
    await descField.fill(firstEdit);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

    const historyCard = page.getByTestId('skill-revision-history');
    await expect(historyCard).toBeVisible();
    await expect(historyCard.getByTestId('skill-revision-row-1')).toBeVisible({
      timeout: 10_000,
    });

    // Second edit — change description again, save. Revision #2.
    await page.getByRole('button', { name: 'Edit' }).click();
    const secondEdit = `flx-13 second edit ${stamp}`;
    await descField.fill(secondEdit);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

    await expect(historyCard.getByTestId('skill-revision-row-2')).toBeVisible();

    // Reload — description persists as the second edit.
    await page.reload();
    await page.locator('li', { hasText: 'research' }).first().click();
    await expect(page.getByText(secondEdit).first()).toBeVisible();

    // Revert to revision #1.
    const historyCardAfter = page.getByTestId('skill-revision-history');
    await expect(historyCardAfter).toBeVisible();
    await historyCardAfter
      .getByTestId('skill-revision-row-1')
      .getByRole('button', { name: /Revert/ })
      .click();

    // Description reverts to firstEdit and a new revision #3 captures
    // the reverted state.
    await expect(page.getByText(firstEdit).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      historyCardAfter.getByTestId('skill-revision-row-3')
    ).toBeVisible();
  });
});
