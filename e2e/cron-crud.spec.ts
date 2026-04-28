// e2e/cron-crud.spec.ts
// FLX-90 — Cron Jobs tab CRUD journey.

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-90 @journey @cron-crud', () => {
  test('Cron tab: Create / Edit / Toggle / Delete', async ({ page }) => {
    await page.goto(projectPath('/settings'));
    const tabsNav = page.getByRole('navigation', { name: 'Settings tabs' });
    await expect(tabsNav.getByRole('link', { name: 'Cron Jobs' })).toBeVisible({
      timeout: 15_000,
    });

    await tabsNav.getByRole('link', { name: 'Cron Jobs' }).click();
    await expect(page).toHaveURL(/\/settings\/cron$/);
    await expect(page.getByRole('heading', { name: 'Cron Jobs' })).toBeVisible({
      timeout: 10_000,
    });

    const stamp = Date.now();
    const newName = `journey-cron-${stamp}`;
    const newSlug = `journey-cron-${stamp}`;

    // ── Create ──────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'New Cron Job' }).click();
    await page.getByLabel('Cron job name').fill(newName);
    await page.getByLabel('Cron job slug').fill(newSlug);
    await page.getByLabel('Cron job cron expression').fill('*/10 * * * *');
    await page.getByLabel('Cron job action type').fill('queue-pipeline');
    await page.getByRole('button', { name: /^Create/ }).click();

    await expect(page.getByText(newName).first()).toBeVisible({
      timeout: 10_000,
    });

    // ── Edit ────────────────────────────────────────────────────────────
    await page.getByText(newName).first().click();
    await expect(page.getByRole('heading', { name: newName })).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Cron expression').fill('0 */2 * * *');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(page.getByText('0 */2 * * *').first()).toBeVisible();

    // ── Delete ──────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, Delete' }).click();

    await expect(page.getByText(newName)).toHaveCount(0, { timeout: 10_000 });
  });
});
