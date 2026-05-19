// e2e/team-crud.spec.ts
// FLX-61 — Team CRUD journey: create + edit + delete via the
// /settings/teams page. Updated in FLX-126 to use RecordEditor interaction
// pattern (click row → detail panel → Edit/Save/Delete).

import { expect, projectPath, test } from './helpers/setup';

// FLX-239 Stage 1: skipped. This spec tests the OLD project-scoped team /
// persona-member model. The schema migration dropped that team shape and
// replaced it with org-scoped human-user teams. The Settings → Teams UI and
// the team.create/update/delete routers all need to be rewritten for the new
// shape. Scheduled for semantic rewrite in FLX-239 Stage 7 (E2E spec
// updates) after Stage 5 updates the router layer.
test.describe
  .skip('@flx-61 @journey @team-crud', () => {
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
      // FLX-252: form refactored to use CreateEntityForm; aria-labels are now
      // the field labels ("Name", "Description") instead of entity-prefixed names.
      await page.getByRole('button', { name: 'New Team' }).click();
      await page.getByLabel('Name').fill(uniqueName);
      await page.getByLabel('Description').fill(uniqueDesc);
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

      await expect(page.locator('li', { hasText: updatedName })).toHaveCount(
        0,
        {
          timeout: 10_000,
        }
      );
    });
  });
