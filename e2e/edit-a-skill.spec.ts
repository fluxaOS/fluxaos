// e2e/edit-a-skill.spec.ts
import { test, expect, gotoSettings } from './helpers/setup';

test.describe('@r-ui-1 @settings @skills @crud', () => {
  test('edit-a-skill', async ({ page }) => {
    const text = `journey: edit-a-skill ran at ${new Date().toISOString()}`;

    await gotoSettings(page, 'skills');

    // Step 2: seeded skills visible
    for (const name of ['research', 'implement', 'review', 'rework', 'deploy']) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }

    // Step 3: click research
    await page.getByText('research', { exact: true }).first().click();

    // Step 4: edit
    await page.getByRole('button', { name: 'Edit' }).click();

    // Step 5: change description
    const descField = page
      .locator('label', { hasText: 'Description' })
      .locator('..')
      .locator('textarea');
    await descField.fill(text);

    // Step 6: save
    await page.getByRole('button', { name: 'Save' }).click();

    // Step 7: back to view mode
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(page.getByText(text)).toBeVisible();

    // Step 8: reload + re-select + verify
    await page.reload();
    await page.getByText('research', { exact: true }).first().click();
    await expect(page.getByText(text)).toBeVisible();
  });
});
