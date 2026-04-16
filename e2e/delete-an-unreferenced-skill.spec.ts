// e2e/delete-an-unreferenced-skill.spec.ts
import { test, expect, gotoSettings } from './helpers/setup';

test.describe('@r-ui-1 @settings @skills @crud', () => {
  test('delete-an-unreferenced-skill', async ({ page }) => {
    const name = `journey-delete-${Date.now()}`;

    await gotoSettings(page, 'skills');

    // Create
    await page.getByRole('button', { name: 'New skill' }).click();
    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Create' }).click();

    // Verify row
    await expect(page.getByText(name).first()).toBeVisible();

    // Select + edit + delete
    await page.getByText(name).first().click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes, delete' }).click();

    // Row gone
    await expect(page.getByText(name)).toHaveCount(0);
  });
});
