// e2e/delete-a-referenced-skill-fails-gracefully.spec.ts
import { test, expect, gotoSettings } from './helpers/setup';

test.describe('@r-ui-1 @settings @skills', () => {
  test('delete-a-referenced-skill-fails-gracefully', async ({ page }) => {
    await gotoSettings(page, 'skills');

    await page.getByText('research', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes, delete' }).click();

    // Banner with FK error message
    await expect(page.getByText(/referenced by/i)).toBeVisible();

    // Research still in list
    await expect(page.getByText('research', { exact: true }).first()).toBeVisible();
  });
});
