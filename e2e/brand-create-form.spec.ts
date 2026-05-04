import { test, expect, gotoSettings } from './helpers/setup';

test('brand create form shows all 7 fields', async ({ page }) => {
  await gotoSettings(page, 'brands');
  await expect(page.getByRole('heading', { name: 'Brands' })).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: 'New Brand' }).click();

  await page.screenshot({ path: 'tests/results/brand-create-form.png', fullPage: true });

  for (const label of ['Brand name', 'Brand scope', 'Tone of voice', 'Style guide', 'Colors JSON', 'Fonts JSON', 'Logo URL']) {
    const el = page.getByRole('textbox', { name: label }).or(page.getByRole('combobox', { name: label }));
    await expect(el).toBeVisible({ timeout: 5_000 });
  }
});
