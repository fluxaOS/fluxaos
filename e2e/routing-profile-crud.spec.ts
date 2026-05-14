// e2e/routing-profile-crud.spec.ts
// FLX-64 — Routing Profile CRUD journey: create + edit + delete via
// /settings/routing. Updated in FLX-126 to use RecordEditor interaction
// pattern (click row → detail panel → Edit/Save/Delete).

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
    // FLX-252: form refactored to use CreateEntityForm; aria-labels are now
    // the field labels ("Name", "Description") instead of entity-prefixed names.
    await page.getByRole('button', { name: 'New Profile' }).click();
    await page.getByLabel('Name').fill(uniqueName);
    await page.getByLabel('Description').fill(description);
    await page.getByRole('button', { name: /^Create/ }).click();

    const row = page.locator('li', { hasText: uniqueName });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // ── Edit ──────────────────────────────────────────────────────────────
    // RecordEditor: click row to select → Edit button appears in detail panel.
    const updatedName = `${uniqueName} EDITED`;
    await row.click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Name').fill(updatedName);
    await page.getByRole('button', { name: 'Save' }).click();

    // Wait for edit mode to exit.
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({
      timeout: 10_000,
    });

    // Persistence: reload + click updated row.
    await page.reload();
    const updatedRow = page.locator('li', { hasText: updatedName });
    await expect(updatedRow).toBeVisible({ timeout: 10_000 });

    // ── Delete ────────────────────────────────────────────────────────────
    // RecordEditor delete: click row → Edit → Delete → Yes, Delete.
    await updatedRow.click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes, Delete' }).click();

    await expect(page.locator('li', { hasText: updatedName })).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});
