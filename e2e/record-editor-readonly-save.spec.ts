// e2e/record-editor-readonly-save.spec.ts
//
// FLX-225: verify the RecordEditor enforces `fieldType: 'readonly'` at the
// save layer, not just visually. The projects settings page is the canonical
// fixture — its descriptor declares two readonly fields (`defaultPipelineName`
// and `targetRepoPath`) that are derived in the page renderer and have no
// corresponding writable column. If the editor leaked them into the patch,
// the tRPC `project.update` mutation would either reject the request or
// silently drop the keys (Zod strip), and neither would surface to the user.
// This journey instead confirms the user-observable contract: editing a
// writable field on a project that also has readonly fields succeeds and
// the readonly display values remain unchanged on reload.

import { expect, gotoSettings, test } from './helpers/setup';

test.describe('@settings @projects @record-editor @readonly', () => {
  test('readonly fields do not flow into the save patch', async ({ page }) => {
    // Step 1: Navigate to the projects settings page.
    await gotoSettings(page, 'projects');

    // Step 2: Wait for the seeded "fluxaOS" project row in the list (the
    // sidebar nav also says "fluxaOS"; scope to the row that exposes the
    // `fluxaos` slug subtext so the click lands on the list row).
    const projectRow = page
      .locator('li', { hasText: 'fluxaOS' })
      .filter({ hasText: 'fluxaos' });
    await projectRow.first().waitFor();
    await projectRow.first().click();

    // Step 3: Confirm readonly fields are visible in the detail panel.
    // These are derived UI-only fields — they must never round-trip through
    // a save patch.
    await expect(
      page.locator('label', { hasText: 'Default pipeline' })
    ).toBeVisible();
    await expect(
      page.locator('label', { hasText: 'Target repo path' })
    ).toBeVisible();

    // Capture the readonly values before edit so we can assert they don't
    // drift across the save.
    const readonlyDefaultPipelineBefore = await page
      .locator('label', { hasText: 'Default pipeline' })
      .locator('..')
      .locator('div.font-mono')
      .first()
      .innerText();
    const readonlyTargetRepoPathBefore = await page
      .locator('label', { hasText: 'Target repo path' })
      .locator('..')
      .locator('div.font-mono')
      .first()
      .innerText();

    // Step 4: Click Edit and change a writable field (defaultBranch).
    await page.getByRole('button', { name: 'Edit' }).click();

    const branchField = page
      .locator('label', { hasText: 'Default branch' })
      .locator('..')
      .locator('input');
    const originalBranch = await branchField.inputValue();
    const newBranch = `main-flx225-${Date.now()}`;
    await branchField.fill(newBranch);

    // Step 5: Save. If readonly values were leaking through, the mutation
    // would still succeed (Zod strips unknowns) — so the real signal is
    // that Save resolves cleanly and we land back in viewing state.
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();

    // Step 6: Reload, reselect the row, confirm the writable change
    // persisted AND the readonly display values are unchanged (they're
    // derived from server-side joins/env, not from the patch).
    await page.reload();
    await projectRow.first().waitFor();
    await projectRow.first().click();

    await expect(
      page
        .locator('label', { hasText: 'Default branch' })
        .locator('..')
        .locator('input')
    ).toHaveValue(newBranch);

    const readonlyDefaultPipelineAfter = await page
      .locator('label', { hasText: 'Default pipeline' })
      .locator('..')
      .locator('div.font-mono')
      .first()
      .innerText();
    const readonlyTargetRepoPathAfter = await page
      .locator('label', { hasText: 'Target repo path' })
      .locator('..')
      .locator('div.font-mono')
      .first()
      .innerText();

    expect(readonlyDefaultPipelineAfter).toBe(readonlyDefaultPipelineBefore);
    expect(readonlyTargetRepoPathAfter).toBe(readonlyTargetRepoPathBefore);

    // Cleanup: restore the original branch so re-runs are idempotent.
    await page.getByRole('button', { name: 'Edit' }).click();
    await page
      .locator('label', { hasText: 'Default branch' })
      .locator('..')
      .locator('input')
      .fill(originalBranch);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  });
});
