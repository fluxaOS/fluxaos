// e2e/persona-crud.spec.ts
// FLX-66 — Persona CRUD journey: create + edit + delete via
// /settings/personas. Edit + Delete affordances added in same PR.

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-66 @journey @persona-crud', () => {
  test('Personas tab: Create / Edit / Delete round-trip', async ({ page }) => {
    await page.goto(projectPath('/settings/personas'));
    await expect(page.getByRole('heading', { name: 'Personas' })).toBeVisible({
      timeout: 15_000,
    });

    const ts = Date.now();
    const uniqueName = `Spec Persona ${ts}`;
    const initialSoul = 'Methodical and careful. Spec-created.';

    // ── Create ────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'New Persona' }).click();
    await page.getByLabel('Persona name').fill(uniqueName);
    await page.getByLabel('Persona soul').fill(initialSoul);
    await page.getByRole('button', { name: /^Create/ }).click();

    const row = page.locator('li', { hasText: uniqueName });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(initialSoul)).toBeVisible();

    // ── Edit ──────────────────────────────────────────────────────────────
    const updatedSoul = 'Edited soul — reckless and brilliant.';
    await row.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Persona soul').fill(updatedSoul);
    await page.getByRole('button', { name: 'Save' }).click();

    // Wait for the edit form to unmount (Save success → setEditingId(null)).
    await expect(
      page.locator('li', { hasText: uniqueName }).getByRole('button', {
        name: 'Edit',
      })
    ).toBeVisible({ timeout: 10_000 });

    // Persistence
    await page.reload();
    const reloadedRow = page.locator('li', { hasText: uniqueName });
    await expect(reloadedRow).toBeVisible({ timeout: 10_000 });
    await expect(reloadedRow.getByText(updatedSoul)).toBeVisible();

    // ── Delete ────────────────────────────────────────────────────────────
    page.once('dialog', (d) => d.accept());
    await reloadedRow.getByRole('button', { name: /^Delete/ }).click();

    await expect(page.locator('li', { hasText: uniqueName })).toHaveCount(0, {
      timeout: 10_000,
    });
  });
});
