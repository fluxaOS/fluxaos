// e2e/system-config-crud.spec.ts
// FLX-89 — System tab CRUD journey. Exercises the new config router +
// /settings/system page (RecordEditor over config_entry).

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-89 @journey @system-config-crud', () => {
  test('System tab: Create / Edit / Delete config entry', async ({ page }) => {
    await page.goto(projectPath('/settings'));
    const tabsNav = page.getByRole('navigation', { name: 'Settings tabs' });
    await expect(tabsNav.getByRole('link', { name: 'System' })).toBeVisible({
      timeout: 15_000,
    });

    await tabsNav.getByRole('link', { name: 'System' }).click();
    await expect(page).toHaveURL(/\/settings\/system$/);
    await expect(page.getByRole('heading', { name: 'System' })).toBeVisible({
      timeout: 10_000,
    });

    const stamp = Date.now();
    const newKey = `flx_89_journey_${stamp}`;
    const newValue = JSON.stringify({ flx89: stamp }, null, 2);

    // ── Create ──────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'New Config Entry' }).click();
    await page.getByLabel('Config entry key').fill(newKey);
    await page.getByLabel('Config entry scope').fill('global');
    await page.getByLabel('Config entry value').fill(newValue);
    await page.getByRole('button', { name: /^Create/ }).click();

    await expect(page.getByText(newKey).first()).toBeVisible({
      timeout: 10_000,
    });

    // ── Edit ────────────────────────────────────────────────────────────
    await page.getByText(newKey).first().click();
    await expect(page.getByRole('heading', { name: newKey })).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();

    const editedValue = JSON.stringify({ flx89: stamp, edited: true }, null, 2);
    await page.getByLabel('Value (JSON)').fill(editedValue);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

    // Reload + reassert persistence — pre-format viewing should show the
    // new value JSON.
    await page.reload();
    await page.getByText(newKey).first().click();
    await expect(
      page.locator('pre', { hasText: '"edited": true' })
    ).toBeVisible();

    // ── Delete ──────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, Delete' }).click();

    await expect(page.getByText(newKey)).toHaveCount(0, { timeout: 10_000 });
  });
});
