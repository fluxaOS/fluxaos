// e2e/project-crud.spec.ts
// FLX-60 — Project CRUD journey: create + edit + delete via /settings/projects.
// Mirrors team-crud.spec.ts shape but uses the RecordEditor list/detail UI
// instead of inline-row editing. The page got "New Project" + RecordEditor
// onDelete wiring in the same PR; this spec is the verification.

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-60 @journey @project-crud', () => {
  test('Projects tab: Create / Edit / Delete round-trip', async ({ page }) => {
    await page.goto(projectPath('/settings/projects'));
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible({
      timeout: 15_000,
    });

    const uniqueName = `CRUD Project ${Date.now()}`;
    const initialRepo = 'https://github.com/fluxaos/spec-target';

    // ── Create ────────────────────────────────────────────────────────────
    // FLX-271: project.slug was dropped — the create form is name + repo URL.
    await page.getByRole('button', { name: 'New Project' }).click();
    await page.getByLabel('Project name').fill(uniqueName);
    await page.getByLabel('Project repo URL').fill(initialRepo);
    await page.getByRole('button', { name: /^Create/ }).click();

    // RecordEditor renders rows as <li> with descriptor.title(p) === p.name
    // and descriptor.subtitle(p) === p.id (UUID).
    const row = page.locator('li', { hasText: uniqueName });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // ── Edit ──────────────────────────────────────────────────────────────
    // Click row → detail card → Edit → change a field → Save.
    await row.click();
    await page.getByRole('button', { name: 'Edit' }).click();

    // FLX-227: a changed repoUrl must be validated through the field's
    // Validate button before Save unblocks (RepoUrlField gates the save
    // patch on un-validated changes), and the URL must be a real public
    // repo because project.update re-validates server-side.
    const updatedRepo = 'https://github.com/fluxaOS/fluxaos';
    const repoInput = page.getByTestId('repo-url-input-repoUrl');
    await repoInput.fill(updatedRepo);
    await page.getByTestId('repo-url-validate').click();
    await expect(page.getByTestId('repo-url-validity-ok')).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Save' }).click();

    // Wait for save to settle: RecordEditor exits editing state on success,
    // which makes the Edit button reappear. Reloading before settle races
    // the mutation and the spec sees stale data.
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({
      timeout: 10_000,
    });

    // Persistence: reload, reselect, assert the persisted value.
    await page.reload();
    const reloadedRow = page.locator('li', { hasText: uniqueName });
    await expect(reloadedRow).toBeVisible({ timeout: 10_000 });
    await reloadedRow.click();
    await expect(page.getByLabel('Repo URL')).toHaveValue(updatedRepo);

    // ── Delete ────────────────────────────────────────────────────────────
    // RecordEditor's Delete affordance is inside the editing state; click
    // Edit, then Delete, then confirm.
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, Delete' }).click();

    await expect(page.locator('li', { hasText: uniqueName })).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});
