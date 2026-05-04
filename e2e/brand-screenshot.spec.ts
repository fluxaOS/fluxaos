// e2e/brand-screenshot.spec.ts
// Brands settings journey: verifies the RecordEditor renders all 6 fields
// (Name, Tone of voice, Style guide, Colors JSON, Fonts JSON, Logo URL) in
// the detail panel, and that the Edit button is present.
import { expect, gotoSettings, test } from './helpers/setup';

test.describe('@flx-126 @journey', () => {
  test('Brands detail panel shows all 6 fields', async ({ page }) => {
    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];

    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await gotoSettings(page, 'brands');

    await expect(
      page.getByRole('heading', { name: 'Brands' })
    ).toBeVisible({ timeout: 10_000 });

    // Click the first brand row (seeded org-scoped brands show "organization" subtitle)
    const firstBrand = page.locator('li').filter({ hasText: 'organization' }).first();
    await expect(firstBrand).toBeVisible({ timeout: 10_000 });
    await firstBrand.click();

    // Wait for the detail panel to open — Edit button signals it rendered
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({
      timeout: 8_000,
    });

    // All 6 field labels must appear in the detail panel.
    // Labels are <label> elements; use locator('label') to avoid matching
    // the "Name *" text (the asterisk is a sibling <span> inside the label).
    for (const label of [
      'Tone of voice',
      'Style guide',
      'Colors JSON',
      'Fonts JSON',
      'Logo URL',
    ]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible({
        timeout: 5_000,
      });
    }
    // Name has a required asterisk sibling, so match loosely
    await expect(
      page.locator('label').filter({ hasText: 'Name' }).first()
    ).toBeVisible({ timeout: 5_000 });

    // Edit button must be present
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

    const knownNoise =
      /Warning: Extra attributes from the server|ResizeObserver loop|hydration/i;

    const unexpectedErrors = consoleErrors.filter((e) => !knownNoise.test(e));
    expect(pageErrors, 'page errors').toHaveLength(0);
    expect(unexpectedErrors, 'console errors').toHaveLength(0);
  });
});
