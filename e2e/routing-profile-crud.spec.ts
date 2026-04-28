// e2e/routing-profile-crud.spec.ts
// FLX-64 — Routing Profile CRUD journey: create + edit + delete via
// /settings/routing. Edit + Delete affordances + the updateProfile
// tRPC endpoint were added in the same PR; this spec is the
// verification.

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-64 @journey @routing-profile-crud', () => {
  test('Routing tab: profile Create / Edit / Delete round-trip', async ({
    page,
  }) => {
    await page.goto(projectPath('/settings/routing'));
    await expect(
      page.getByRole('heading', { name: 'Routing Profiles' })
    ).toBeVisible({ timeout: 15_000 });

    const ts = Date.now();
    const uniqueName = `Spec Profile ${ts}`;
    const description = 'Spec-created profile — safe to delete.';

    // ── Create ────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'New Profile' }).click();
    await page.getByLabel('Profile name').fill(uniqueName);
    await page.getByLabel('Profile description').fill(description);
    await page.getByRole('button', { name: /^Create/ }).click();

    const row = page.locator('li', { hasText: uniqueName });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(description)).toBeVisible();

    // ── Edit ──────────────────────────────────────────────────────────────
    const updatedName = `${uniqueName} EDITED`;
    await row.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Profile name').fill(updatedName);
    await page.getByRole('button', { name: 'Save' }).click();

    const updatedRow = page.locator('li', { hasText: updatedName });
    await expect(updatedRow).toBeVisible({ timeout: 10_000 });

    // Persistence
    await page.reload();
    await expect(page.locator('li', { hasText: updatedName })).toBeVisible({
      timeout: 10_000,
    });

    // ── Delete ────────────────────────────────────────────────────────────
    page.once('dialog', (d) => d.accept());
    await page
      .locator('li', { hasText: updatedName })
      .getByRole('button', { name: /^Delete/ })
      .click();

    await expect(page.locator('li', { hasText: updatedName })).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});
