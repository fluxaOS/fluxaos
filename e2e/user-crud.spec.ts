// e2e/user-crud.spec.ts
// FLX-3 — Users tab CRUD journey. Exercises the new RecordEditor-driven
// /settings/users page (create, edit, delete).

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-3 @journey @users-crud', () => {
  test('Users tab: Create / Edit / Delete round-trip', async ({ page }) => {
    // Settings nav surfaces the Users tab.
    await page.goto(projectPath('/settings'));
    const tabsNav = page.getByRole('navigation', { name: 'Settings tabs' });
    await expect(tabsNav.getByRole('link', { name: 'Users' })).toBeVisible({
      timeout: 15_000,
    });

    await tabsNav.getByRole('link', { name: 'Users' }).click();
    await expect(page).toHaveURL(/\/settings\/users$/);
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible({
      timeout: 10_000,
    });

    const stamp = Date.now();
    const newName = `CRUD User ${stamp}`;
    const newEmail = `crud-${stamp}@example.test`;
    const newSlug = `crud-${stamp}`;

    // ── Create ──────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'New User' }).click();
    await page.getByLabel('User name').fill(newName);
    await page.getByLabel('User email').fill(newEmail);
    await page.getByLabel('User slug').fill(newSlug);
    await page.getByRole('button', { name: /^Create/ }).click();

    // Newly created user appears in the RecordEditor list.
    await expect(page.getByText(newName).first()).toBeVisible({
      timeout: 10_000,
    });

    // ── Edit ────────────────────────────────────────────────────────────
    await page.getByText(newName).first().click();
    await expect(page.getByRole('heading', { name: newName })).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();

    const editedName = `${newName} EDITED`;
    await page.getByLabel('Name').fill(editedName);
    await page.getByRole('button', { name: 'Save' }).click();

    // Returns to viewing state; list and heading reflect new name.
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(page.getByRole('heading', { name: editedName })).toBeVisible();

    // Persistence — reload, list still shows updated name.
    await page.reload();
    await expect(page.getByText(editedName).first()).toBeVisible({
      timeout: 10_000,
    });

    // ── Delete ──────────────────────────────────────────────────────────
    await page.getByText(editedName).first().click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, Delete' }).click();

    await expect(page.getByText(editedName)).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});
