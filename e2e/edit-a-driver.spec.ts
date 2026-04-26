// e2e/edit-a-driver.spec.ts
import { expect, gotoSettings, test } from './helpers/setup';

test.describe('@r-ui-1 @settings @drivers @crud', () => {
  test('edit-a-driver', async ({ page }) => {
    const timestamp = new Date().toISOString();
    const noteText = `journey: edit-a-driver ran at ${timestamp}`;

    // Step 1: Navigate
    await gotoSettings(page, 'drivers');

    // Step 2: Verify list shows Claude Code
    await expect(page.getByText('Claude Code')).toBeVisible();

    // Step 3: Click row
    await page.getByText('Claude Code').first().click();

    // Step 4: Detail panel visible with expected fields.
    // Use label-locator (the field label is "Binary" with an `*` sibling span
    // that makes plain getByText non-unique — it also matches the page
    // description "... AI CLI tool ... (binary, flags, transport, env)").
    await expect(
      page.getByRole('heading', { name: 'Claude Code' })
    ).toBeVisible();
    await expect(page.locator('label', { hasText: 'Binary' })).toBeVisible();

    // Step 5: Click Edit
    await page.getByRole('button', { name: 'Edit' }).click();

    // Step 6: Change Notes field
    const notesField = page
      .locator('label', { hasText: 'Notes' })
      .locator('..')
      .locator('textarea');
    await notesField.fill(noteText);

    // Step 7: Click Save
    await page.getByRole('button', { name: 'Save' }).click();

    // Step 8: Returned to viewing state
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

    // Step 9: Reload
    await page.reload();

    // Step 10: Click row again
    await page.getByText('Claude Code').first().click();

    // Step 11: Verify notes persisted
    await expect(page.getByText(noteText)).toBeVisible();
  });
});
