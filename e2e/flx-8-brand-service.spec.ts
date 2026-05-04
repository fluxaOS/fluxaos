import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-8 @journey @brand-service', () => {
  test('Brands tab: Create / Edit round-trip', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto(projectPath('/settings/brands'));
    await expect(page.getByRole('heading', { name: 'Brands' })).toBeVisible({
      timeout: 15_000,
    });

    const ts = Date.now();
    const brandName = `FLX-8 Runtime Brand ${ts}`;
    const updatedTone = 'Direct, concrete, operator-focused.';

    // ── Create ────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'New Brand' }).click();
    await page.getByLabel('Brand name').fill(brandName);
    await page.getByLabel('Tone of voice').fill('Direct and practical.');
    await page.getByLabel('Style guide').fill('Lead with outcomes.');
    await page.getByRole('button', { name: /^Create/ }).click();

    const row = page.locator('li', { hasText: brandName });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // ── Edit ──────────────────────────────────────────────────────────────
    // RecordEditor: click row to select → Edit button appears in detail panel.
    await row.click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Tone of voice').fill(updatedTone);
    await page.getByRole('button', { name: 'Save' }).click();

    // Wait for edit mode to exit.
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({
      timeout: 10_000,
    });

    // Persistence: reload + click row + verify updated tone in detail panel.
    await page.reload();
    const reloadedRow = page.locator('li', { hasText: brandName });
    await expect(reloadedRow).toBeVisible({ timeout: 10_000 });
    await reloadedRow.click();
    await expect(page.getByText(updatedTone)).toBeVisible({ timeout: 5_000 });

    // ── Persona brand assignment ──────────────────────────────────────────
    await page.goto(projectPath('/settings/personas'));
    await expect(page.getByRole('heading', { name: 'Personas' })).toBeVisible({
      timeout: 15_000,
    });
    const personaName = `FLX-8 Persona ${ts}`;
    await page.getByRole('button', { name: 'New Persona' }).click();
    await page.getByLabel('Persona name').fill(personaName);
    await page.getByLabel('Persona soul').fill('Uses brand context.');
    await page.getByRole('button', { name: /^Create/ }).click();
    const personaRow = page.locator('li', { hasText: personaName });
    await expect(personaRow).toBeVisible({ timeout: 10_000 });
    await personaRow.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Persona brand').selectOption({ label: brandName });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.locator('li', { hasText: brandName }).first()
    ).toBeVisible({
      timeout: 10_000,
    });

    // ── Project default brand ─────────────────────────────────────────────
    await page.goto(projectPath('/settings/projects'));
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible({
      timeout: 15_000,
    });
    await page
      .getByLabel(/Default brand for fluxaOS/i)
      .selectOption({ label: brandName });
    await page.reload();
    await expect(page.getByLabel(/Default brand for fluxaOS/i)).toHaveValue(
      /.+/
    );

    expect(errors).toEqual([]);
  });
});
