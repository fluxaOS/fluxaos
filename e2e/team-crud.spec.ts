// e2e/team-crud.spec.ts
// FLX-61 — Team CRUD journey: create + edit + delete via the
// /settings/teams page. Updated in FLX-126 to use RecordEditor interaction
// pattern (click row → detail panel → Edit/Save/Delete).

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-61 @journey @team-crud', () => {
  test('Teams tab renders + Create / Edit / Delete round-trip', async ({
    page,
  }) => {
    // Settings nav surfaces the Teams tab (FLX-61 added it).
    await page.goto(projectPath('/settings'));
    const tabsNav = page.getByRole('navigation', { name: 'Settings tabs' });
    await expect(tabsNav.getByRole('link', { name: 'Teams' })).toBeVisible({
      timeout: 15_000,
    });

    await tabsNav.getByRole('link', { name: 'Teams' }).click();
    await expect(page).toHaveURL(/\/settings\/teams$/);
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({
      timeout: 10_000,
    });

    const uniqueName = `CRUD Team ${Date.now()}`;
    const uniqueDesc = 'Spec-created team — safe to delete.';

    // ── Create ────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'New Team' }).click();
    await page.getByLabel('Team name').fill(uniqueName);
    await page.getByLabel('Team description').fill(uniqueDesc);
    await page.getByRole('button', { name: /^Create/ }).click();

    const row = page.locator('li', { hasText: uniqueName });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // ── Edit ──────────────────────────────────────────────────────────────
    // RecordEditor: click row to select → Edit button appears in detail panel.
    await row.click();
    await page.getByRole('button', { name: 'Edit' }).click();

    const updatedName = `${uniqueName} EDITED`;
    await page.getByLabel('Name').fill(updatedName);
    await page.getByRole('button', { name: 'Save' }).click();

    // Wait for edit mode to exit (Save → back to viewing state).
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({
      timeout: 10_000,
    });

    // Persistence: reload + click the updated row + verify in detail panel.
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
