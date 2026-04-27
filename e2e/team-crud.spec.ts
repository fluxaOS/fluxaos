// e2e/team-crud.spec.ts
// FLX-61 — Team CRUD journey: create + edit + delete via the new
// /settings/teams page. Schema already exists; this spec exercises the
// freshly built tRPC router + UI.

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
    await expect(row.getByText(uniqueDesc)).toBeVisible();

    // ── Edit ──────────────────────────────────────────────────────────────
    // After clicking Edit, the row's display text is replaced with the
    // inline form, so a `hasText: uniqueName` filter on <li> stops
    // matching. Pivot to page-level locators while editing — only one
    // edit form is open at a time.
    const updatedName = `${uniqueName} EDITED`;
    await row.getByRole('button', { name: 'Edit' }).click();
    const nameInput = page.getByLabel('Team name');
    await nameInput.fill(updatedName);
    await page.getByRole('button', { name: 'Save' }).click();

    const updatedRow = page.locator('li', { hasText: updatedName });
    await expect(updatedRow).toBeVisible({ timeout: 10_000 });

    // Persistence: reload + reassert.
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
