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

    await page.getByRole('button', { name: 'New Brand' }).click();
    await page.getByLabel('Brand name').fill(brandName);
    await page.getByLabel('Tone of voice').fill('Direct and practical.');
    await page.getByLabel('Style guide').fill('Lead with outcomes.');
    await page.getByRole('button', { name: /^Create/ }).click();

    const row = page.locator('li', { hasText: brandName });
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Tone of voice').fill(updatedTone);
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(
      page.locator('li', { hasText: brandName }).getByRole('button', {
        name: 'Edit',
      })
    ).toBeVisible({ timeout: 10_000 });

    await page.reload();
    const reloadedRow = page.locator('li', { hasText: brandName });
    await expect(reloadedRow).toBeVisible({ timeout: 10_000 });
    await expect(reloadedRow.getByText(updatedTone)).toBeVisible();

    expect(errors).toEqual([]);
  });
});
