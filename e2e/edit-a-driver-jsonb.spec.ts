// e2e/edit-a-driver-jsonb.spec.ts
import { expect, gotoSettings, test } from './helpers/setup';

test.describe('@flx-38 @settings @drivers @jsonb', () => {
  test('edit-a-driver-jsonb-field', async ({ page }) => {
    const stamp = Date.now();
    const newDefaultArgs = ['--print', '--journey', String(stamp)];

    await gotoSettings(page, 'drivers');
    await expect(page.getByText('Claude Code')).toBeVisible();
    await page.getByText('Claude Code').first().click();
    await expect(
      page.getByRole('heading', { name: 'Claude Code' })
    ).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).click();

    // Locate the defaultArgs textarea by its aria-label (set by the field
    // label, "Default args (JSON array of strings)").
    const defaultArgsField = page.getByLabel(
      'Default args (JSON array of strings)'
    );
    await expect(defaultArgsField).toBeVisible();
    await expect(defaultArgsField).toBeEditable();

    // Step 1 — invalid JSON blocks Save with an inline parse error.
    await defaultArgsField.fill('not json');
    await expect(page.getByText(/Invalid JSON/)).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    // Still in edit mode (Save button is what was clicked, so it should
    // still be visible — Cancel disappears only after Save succeeds).
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(page.getByText(/Invalid JSON/)).toBeVisible();

    // Step 2 — wrong shape (not array of strings) hits descriptor validate.
    await defaultArgsField.fill('{ "wrong": "shape" }');
    await expect(page.getByText(/Invalid JSON/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      page.getByText(/Must be a JSON array of strings/)
    ).toBeVisible();

    // Step 3 — valid array saves and persists across reload.
    await defaultArgsField.fill(JSON.stringify(newDefaultArgs, null, 2));
    await page.getByRole('button', { name: 'Save' }).click();

    // Save returns to viewing state — Edit button reappears.
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

    await page.reload();
    await page.getByText('Claude Code').first().click();

    // The viewing-mode renderer formats the JSON with 2-space indent. Match
    // any chunk of the expected formatted output to confirm persistence.
    const expectedFormatted = JSON.stringify(newDefaultArgs, null, 2);
    await expect(
      page.locator('pre', { hasText: expectedFormatted })
    ).toBeVisible();
  });
});
