// e2e/provider-crud.spec.ts
// FLX-65 — Provider CRUD journey: create + edit + delete via
// /settings/providers. Updated in FLX-126 to use RecordEditor interaction
// pattern (click row → detail panel → Edit/Save/Delete).

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-65 @journey @provider-crud', () => {
  test('Providers tab: Create / Edit / Delete round-trip', async ({ page }) => {
    await page.goto(projectPath('/settings/providers'));
    await expect(page.getByRole('heading', { name: 'Providers' })).toBeVisible({
      timeout: 15_000,
    });

    const ts = Date.now();
    const uniqueName = `Spec Provider ${ts}`;
    const initialType = `spec-type-${ts}`;
    const initialBaseUrl = 'https://example.test/api';

    // ── Create ────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'New Provider' }).click();
    await page.getByLabel('Provider name').fill(uniqueName);
    await page.getByLabel('Provider type').fill(initialType);
    await page.getByLabel('Provider base URL').fill(initialBaseUrl);
    await page.getByRole('button', { name: /^Create/ }).click();

    const row = page.locator('li', { hasText: uniqueName });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // ── Edit ──────────────────────────────────────────────────────────────
    // RecordEditor: click row to select → Edit button appears in detail panel.
    const updatedBaseUrl = 'https://example.test/api/v2';
    await row.click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Base URL').fill(updatedBaseUrl);
    await page.getByRole('button', { name: 'Save' }).click();

    // Wait for edit mode to exit.
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({
      timeout: 10_000,
    });

    // Persistence: reload + click row + verify in detail panel.
    await page.reload();
    const reloadedRow = page.locator('li', { hasText: uniqueName });
    await expect(reloadedRow).toBeVisible({ timeout: 10_000 });
    await reloadedRow.click();
    await expect(page.getByLabel('Base URL')).toHaveValue(updatedBaseUrl, {
      timeout: 5_000,
    });

    // ── Delete ────────────────────────────────────────────────────────────
    // RecordEditor delete: row already selected → Edit → Delete → Yes, Delete.
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes, Delete' }).click();

    await expect(page.locator('li', { hasText: uniqueName })).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});
