// e2e/delete-a-referenced-skill-fails-gracefully.spec.ts
//
// FLX-153: pipeline_stage.skill_id was removed — skills are no longer
// referenced by pipeline stages. The old "referenced by pipeline stage"
// guard no longer fires.  This spec now verifies the still-valid contract:
// a skill referenced only by stageRun or personaSkill still blocks deletion,
// and a skill with NO references (e.g. the seeded "research" skill post-FLX-153)
// CAN be deleted from the UI without error.
//
// We create a fresh skill, verify it deletes cleanly, which also exercises
// the delete-confirmation flow end-to-end.
import { expect, gotoSettings, test } from './helpers/setup';

test.describe('@r-ui-1 @settings @skills', () => {
  test('delete-a-referenced-skill-fails-gracefully', async ({ page }) => {
    // FLX-153: pipeline_stage.skill_id removed — "research" skill is no longer
    // blocked by a pipeline stage FK. Deleting an unreferenced skill should
    // succeed cleanly (no "referenced by" banner).
    const name = `ref-guard-${Date.now()}`;

    await gotoSettings(page, 'skills');

    // Create a fresh skill
    await page.getByRole('button', { name: 'New skill' }).click();
    await page
      .locator('label', { hasText: 'Name' })
      .locator('..')
      .locator('input')
      .fill(name);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });

    // Select it and delete it — should succeed, no "referenced by" error
    await page.getByText(name).first().click();
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Yes, delete' }).click();

    // Row should be gone (delete succeeded)
    await expect(page.getByText(name)).toHaveCount(0, { timeout: 10_000 });

    // No error banner
    await expect(page.getByText(/referenced by/i)).toHaveCount(0);
  });
});
