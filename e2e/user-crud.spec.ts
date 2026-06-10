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

    // ── Create ──────────────────────────────────────────────────────────
    // FLX-271: user.slug was dropped — the create form is name + email.
    await page.getByRole('button', { name: 'New User' }).click();
    await page.getByLabel('User name').fill(newName);
    await page.getByLabel('User email').fill(newEmail);
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

    // ── Edit role (FLX-12) ──────────────────────────────────────────────
    // The Role field is a select with admin/maintainer/viewer.
    await page.getByText(editedName).first().click();
    await page.getByRole('button', { name: 'Edit' }).click();
    const roleSelect = page.getByLabel('Role', { exact: true });
    await expect(roleSelect).toBeVisible();
    // Default is 'admin' (grandfathered). Change to 'maintainer' and save.
    await roleSelect.selectOption('maintainer');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

    // Reload — role persists. Read from the select's value, not text
    // (the select renders all options as <option>, so getByText would
    // match the hidden options too).
    await page.reload();
    await page.getByText(editedName).first().click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByLabel('Role', { exact: true })).toHaveValue(
      'maintainer'
    );
    // Cancel out of edit mode without saving.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

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
