// e2e/delete-an-unreferenced-skill.spec.ts
import { expect, gotoSettings, test } from './helpers/setup';

test.describe('@r-ui-1 @settings @skills @crud', () => {
  test('delete-an-unreferenced-skill', async ({ page }) => {
    const name = `journey-delete-${Date.now()}`;

    await gotoSettings(page, 'skills');

    // Wait for the initial skill.list fetch to land (seeded row visible)
    // BEFORE creating. Creating while that fetch is in flight loses the
    // post-create invalidation to request dedupe (FLX-279) and the new row
    // never appears without a reload.
    await expect(
      page
        .getByTestId('record-editor-list')
        .locator('li', { hasText: 'research' })
        .first()
    ).toBeVisible({ timeout: 15_000 });

    // Create.
    // NOTE: The skills Create form renders its Name <label> as a sibling
    // wrapping the <input> (no htmlFor/id pair), so Playwright's getByLabel
    // can't resolve it. Use the label-parent-input locator pattern.
    await page.getByRole('button', { name: 'New skill' }).click();
    await page
      .locator('label', { hasText: 'Name' })
      .locator('..')
      .locator('input')
      .fill(name);
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
