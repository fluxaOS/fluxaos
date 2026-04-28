// e2e/provider-crud.spec.ts
// FLX-65 — Provider CRUD journey: create + edit + delete via
// /settings/providers. Edit + Delete affordances added in same PR.

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
    await expect(row.getByText(initialType)).toBeVisible();

    // ── Edit ──────────────────────────────────────────────────────────────
    const updatedBaseUrl = 'https://example.test/api/v2';
    await row.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Provider base URL').fill(updatedBaseUrl);
    await page.getByRole('button', { name: 'Save' }).click();

    // Wait for the edit form to unmount (Save success → setEditingId(null)).
    // Reloading before this races the mutation.
    await expect(
      page.locator('li', { hasText: uniqueName }).getByRole('button', {
        name: 'Edit',
      })
    ).toBeVisible({ timeout: 10_000 });

    // Persistence
    await page.reload();
    const reloadedRow = page.locator('li', { hasText: uniqueName });
    await expect(reloadedRow).toBeVisible({ timeout: 10_000 });
    await expect(reloadedRow.getByText(updatedBaseUrl)).toBeVisible();

    // ── Delete ────────────────────────────────────────────────────────────
    page.once('dialog', (d) => d.accept());
    await reloadedRow.getByRole('button', { name: /^Delete/ }).click();

    await expect(page.locator('li', { hasText: uniqueName })).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});
