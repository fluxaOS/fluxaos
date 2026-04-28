// e2e/delete-an-unreferenced-driver.spec.ts
// FLX-63 — Driver delete (unreferenced): create a fresh driver, then
// delete it. Mirrors the skill-delete pair. Using a freshly created
// driver guarantees the FK guard finds zero references.

import { expect, gotoSettings, test } from './helpers/setup';

test.describe('@flx-63 @journey @driver-delete', () => {
  test('delete-an-unreferenced-driver', async ({ page }) => {
    const ts = Date.now();
    const name = `journey-delete-driver-${ts}`;
    const slug = `journey-delete-driver-${ts}`;

    await gotoSettings(page, 'drivers');

    // Create
    await page.getByRole('button', { name: 'New Driver' }).click();
    await page.getByLabel('Driver name').fill(name);
    await page.getByLabel('Driver slug').fill(slug);
    await page.getByLabel('Driver binary').fill('echo');
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const row = page.locator('li', { hasText: name });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Select → Edit → Delete → confirm
    await row.click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, Delete' }).click();

    await expect(page.locator('li', { hasText: name })).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});
