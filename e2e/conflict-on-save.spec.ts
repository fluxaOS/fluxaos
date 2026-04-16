// e2e/conflict-on-save.spec.ts
// Stability notes: both tabs must fully load the skills list AND open the
// same record in edit mode before either tab clicks Save. Without the
// waitForLoadState('networkidle') calls, one tab may still be fetching the
// list or the Edit state when the other tab saves, producing spurious "no
// version in state" failures that look like flake but are really races.
import { test, expect, gotoSettings } from './helpers/setup';

test.describe('@r-ui-1 @settings @concurrency', () => {
  test('conflict-on-save', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();

    try {
      // Both tabs load the list fully
      await gotoSettings(a, 'skills');
      await a.waitForLoadState('networkidle');
      await gotoSettings(b, 'skills');
      await b.waitForLoadState('networkidle');

      // Both tabs select the same record, wait for the detail panel to render,
      // then click Edit. Waiting on the Edit button (not arbitrary timing)
      // guarantees the record is fully loaded before we mutate.
      await a.getByText('research', { exact: true }).first().click();
      await expect(a.getByRole('button', { name: 'Edit' })).toBeVisible();
      await b.getByText('research', { exact: true }).first().click();
      await expect(b.getByRole('button', { name: 'Edit' })).toBeVisible();

      await a.getByRole('button', { name: 'Edit' }).click();
      await b.getByRole('button', { name: 'Edit' }).click();

      // Wait for the editable textarea in each tab so both tabs have the
      // same version captured in local state before either saves.
      const aDesc = a
        .locator('label', { hasText: 'Description' })
        .locator('..')
        .locator('textarea');
      const bDesc = b
        .locator('label', { hasText: 'Description' })
        .locator('..')
        .locator('textarea');
      await expect(aDesc).toBeEditable();
      await expect(bDesc).toBeEditable();

      // Tab A saves first
      await aDesc.fill('A-change');
      await a.getByRole('button', { name: 'Save' }).click();
      await expect(a.getByRole('button', { name: 'Edit' })).toBeVisible();
      await a.waitForLoadState('networkidle');

      // Tab B saves second — expect a conflict
      await bDesc.fill('B-change');
      await b.getByRole('button', { name: 'Save' }).click();

      // Conflict banner shown in B (with Refresh button per spec)
      await expect(b.getByText(/updated elsewhere|conflict/i)).toBeVisible();
      await expect(b.getByRole('button', { name: 'Refresh' })).toBeVisible();

      // B clicks Refresh and sees A's change
      await b.getByRole('button', { name: 'Refresh' }).click();
      await b.getByText('research', { exact: true }).first().click();
      await expect(b.getByText('A-change')).toBeVisible();
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
