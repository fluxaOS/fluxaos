// e2e/issue-crud.spec.ts
// FLX-67 — Issue CRUD (Create + Edit + Delete) journey tests.
//
// Currently the create/edit/delete code paths are exercised as setup in
// other specs (FLX-20, FLX-27) but no spec verifies them in isolation.
// This file fills the matrix gap.
//
// All three flows run against a real database via the dev server; no
// orchestrator, no live Claude. Each test is self-contained and cleans
// up the issue it created.

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-67 @journey @issue-crud', () => {
  test('Create — fills /issues/new, redirects to detail, persists after reload', async ({
    page,
  }) => {
    await page.goto(projectPath('/issues/new'));

    await expect(page.getByRole('heading', { name: 'New Issue' })).toBeVisible({
      timeout: 15_000,
    });

    const uniqueTitle = `CRUD Create Test ${Date.now()}`;
    const uniqueBody = '## Body\n\nTest description with **markdown**.';

    await page.getByPlaceholder('Issue title').fill(uniqueTitle);
    await page
      .getByPlaceholder('Describe the issue (Markdown)')
      .fill(uniqueBody);

    // Type + Priority dropdowns auto-populate to first option; Assignee
    // optional. Just submit.
    await page.getByPlaceholder('Optional').fill('alice');
    await page.getByRole('button', { name: /Create Issue/ }).click();

    // Redirects to /issues/<number>. Heading shows the new title.
    await expect(
      page.getByRole('heading', { name: new RegExp(uniqueTitle) })
    ).toBeVisible({ timeout: 15_000 });

    // URL pattern check.
    expect(page.url()).toMatch(/\/issues\/\d+$/);

    // Reload — persistence check.
    await page.reload();
    await expect(
      page.getByRole('heading', { name: new RegExp(uniqueTitle) })
    ).toBeVisible({ timeout: 15_000 });

    // Body markdown rendered to HTML at write time (server invariant).
    await expect(page.getByText(/Body/).first()).toBeVisible();

    // Cleanup: delete via UI Delete Issue button. Auto-accept the confirm.
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /Delete Issue/ }).click();
    await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Edit — fields persist via inline editors and dropdowns', async ({
    page,
  }) => {
    // Create a fresh issue to edit.
    await page.goto(projectPath('/issues/new'));
    const original = `CRUD Edit Test ${Date.now()}`;
    await page.getByPlaceholder('Issue title').fill(original);
    await page.getByRole('button', { name: /Create Issue/ }).click();
    await expect(
      page.getByRole('heading', { name: new RegExp(original) })
    ).toBeVisible({ timeout: 15_000 });

    // ── Edit title via inline EditableTitle ────────────────────────────────
    const updated = `${original} EDITED`;
    await page.getByRole('heading', { name: new RegExp(original) }).click();
    const titleInput = page.locator('input[type="text"]').first();
    await titleInput.fill(updated);
    await titleInput.press('Enter');
    await expect(
      page.getByRole('heading', { name: new RegExp(updated) })
    ).toBeVisible({ timeout: 10_000 });

    // ── Edit body via inline EditableBody ──────────────────────────────────
    const newBody = 'Updated body via edit test';
    await page
      .getByText('No description. Click to add one.', { exact: false })
      .click();
    await page.locator('textarea').first().fill(newBody);
    await page.getByRole('button', { name: 'Save' }).click();
    // Body text renders in two places after save: inline body view and the
    // ActivityFeed change-summary entry. Use .first() (the body render).
    await expect(page.getByText(newBody, { exact: false }).first()).toBeVisible(
      {
        timeout: 10_000,
      }
    );

    // ── Change priority via CatalogSelect ──────────────────────────────────
    const prioritySelect = page
      .locator('div.flex.items-center.gap-2', {
        has: page.locator('span', { hasText: /^Priority$/ }),
      })
      .locator('select');
    const priorityLabels = await prioritySelect.evaluate((el) => {
      const select = el as HTMLSelectElement;
      return Array.from(select.options).map((o) => o.text);
    });
    const currentPriority = await prioritySelect.evaluate((el) => {
      const select = el as HTMLSelectElement;
      return select.options[select.selectedIndex]?.text ?? '';
    });
    const targetPriority = priorityLabels.find((p) => p !== currentPriority);
    expect(targetPriority).toBeTruthy();
    await prioritySelect.selectOption({ label: targetPriority! });
    await expect
      .poll(
        async () =>
          prioritySelect.evaluate((el) => {
            const select = el as HTMLSelectElement;
            return select.options[select.selectedIndex]?.text ?? '';
          }),
        { timeout: 10_000, intervals: [250, 500, 1_000] }
      )
      .toBe(targetPriority!);

    // ── Reload — every change persisted ────────────────────────────────────
    await page.reload();
    await expect(
      page.getByRole('heading', { name: new RegExp(updated) })
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(newBody, { exact: false }).first()
    ).toBeVisible();
    const prioritySelect2 = page
      .locator('div.flex.items-center.gap-2', {
        has: page.locator('span', { hasText: /^Priority$/ }),
      })
      .locator('select');
    const persistedPriority = await prioritySelect2.evaluate((el) => {
      const select = el as HTMLSelectElement;
      return select.options[select.selectedIndex]?.text ?? '';
    });
    expect(persistedPriority).toBe(targetPriority);

    // Cleanup.
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /Delete Issue/ }).click();
    await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Delete — confirm + redirect + row gone from list', async ({ page }) => {
    // Create a fresh issue to delete.
    await page.goto(projectPath('/issues/new'));
    const title = `CRUD Delete Test ${Date.now()}`;
    await page.getByPlaceholder('Issue title').fill(title);
    await page.getByRole('button', { name: /Create Issue/ }).click();
    await expect(
      page.getByRole('heading', { name: new RegExp(title) })
    ).toBeVisible({ timeout: 15_000 });

    const issueUrl = page.url();
    const issueNumber = issueUrl.match(/\/issues\/(\d+)$/)?.[1];
    expect(issueNumber).toBeTruthy();

    // Click Delete, accept confirm dialog.
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /Delete Issue/ }).click();

    // Redirects to /issues list.
    await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible({
      timeout: 15_000,
    });

    // The deleted row is no longer present.
    await page.waitForLoadState('networkidle');

    // Switch to "All Issues" filter to ensure the row would render if it
    // still existed (in case default filter excludes the type).
    const lifecycleSelect = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'All Issues' }) })
      .first();
    await lifecycleSelect.selectOption('all');

    await expect(page.getByText(title, { exact: false })).toHaveCount(0);

    // Direct nav to the deleted issue: detail view should report not found.
    await page.goto(issueUrl);
    await expect(page.getByText(/not found/i, { exact: false })).toBeVisible({
      timeout: 10_000,
    });
  });
});
