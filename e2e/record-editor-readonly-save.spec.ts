// e2e/record-editor-readonly-save.spec.ts
//
// FLX-225 — RecordEditor strips `fieldType: 'readonly'` keys from the save
// patch. Originally proven on the Projects page's readonly Default-pipeline /
// Target-repo-path fields; FLX-207 made every Projects field editable, so the
// journey moved to the Skills page (FLX-239 Stage 7), whose descriptor keeps
// `version` as a readonly field. The behavior under test is unchanged: a
// descriptor with a readonly key present must save cleanly (the readonly key
// never round-trips through the update mutation) and the server stays the
// owner of the readonly value.

import { expect, gotoSettings, test } from './helpers/setup';

test.describe('@settings @skills @record-editor @readonly', () => {
  test('readonly fields do not flow into the save patch', async ({ page }) => {
    // Step 1: Navigate to the skills settings page.
    await gotoSettings(page, 'skills');

    // Step 2: Select the seeded "research" skill row.
    const skillRow = page
      .getByTestId('record-editor-list')
      .locator('li', { hasText: 'research' });
    await skillRow.first().waitFor();
    await skillRow.first().click();

    // Step 3: The detail panel renders Version as an explicit read-only
    // field (dashed border + "(read-only)" suffix + aria-readonly).
    await expect(page.locator('label', { hasText: 'Version' })).toBeVisible();
    const readonlyVersion = page.locator('[aria-readonly="true"]').first();
    await expect(readonlyVersion).toBeVisible();
    const versionBefore = Number(await readonlyVersion.innerText());
    expect(Number.isInteger(versionBefore)).toBe(true);

    // Step 4: Click Edit and change a writable field (description).
    await page.getByRole('button', { name: 'Edit' }).click();
    const descriptionField = page
      .locator('label', { hasText: 'Description' })
      .locator('..')
      .locator('textarea');
    const originalDescription = await descriptionField.inputValue();
    const newDescription = `flx-225 readonly save ${Date.now()}`;
    await descriptionField.fill(newDescription);

    // Step 5: Save. If the readonly `version` key leaked into the patch,
    // the update would try to write a stale client value into a
    // server-owned column. The save must resolve cleanly back to viewing.
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({
      timeout: 10_000,
    });

    // Step 6: Reload, reselect, confirm the writable change persisted AND
    // the readonly version advanced server-side (optimistic-lock bump) —
    // proof the server owns it, not the client patch.
    await page.reload();
    await skillRow.first().waitFor();
    await skillRow.first().click();

    await expect(page.getByText(newDescription).first()).toBeVisible({
      timeout: 10_000,
    });

    const versionAfter = Number(
      await page.locator('[aria-readonly="true"]').first().innerText()
    );
    expect(versionAfter).toBe(versionBefore + 1);

    // Cleanup: restore the original description so re-runs are idempotent.
    await page.getByRole('button', { name: 'Edit' }).click();
    await page
      .locator('label', { hasText: 'Description' })
      .locator('..')
      .locator('textarea')
      .fill(originalDescription);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({
      timeout: 10_000,
    });
  });
});
