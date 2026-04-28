// e2e/create-a-driver.spec.ts
// FLX-62 — Driver Create journey: open New Driver form, fill required
// fields including the contextLayout JSON (FLX-78 made the column
// non-null with no default), submit, assert row appears in the
// RecordEditor list.

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-62 @journey @driver-create', () => {
  test('Drivers tab: New Driver round-trips into the list', async ({
    page,
  }) => {
    await page.goto(projectPath('/settings/drivers'));
    await expect(page.getByRole('heading', { name: 'Drivers' })).toBeVisible({
      timeout: 15_000,
    });

    const ts = Date.now();
    const uniqueName = `Spec Driver ${ts}`;
    const uniqueSlug = `spec-driver-${ts}`;
    const binary = 'echo';

    await page.getByRole('button', { name: 'New Driver' }).click();
    await page.getByLabel('Driver name').fill(uniqueName);
    await page.getByLabel('Driver slug').fill(uniqueSlug);
    await page.getByLabel('Driver binary').fill(binary);
    // Default contextLayout JSON in the form is valid; leave it as-is.

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // RecordEditor renders rows as <li> with descriptor.title(d) === d.name.
    const row = page.locator('li', { hasText: uniqueName });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText(uniqueSlug)).toBeVisible();
  });
});
