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
      // Both tabs load the list fully. Use a deterministic signal (seeded
      // skill name visible) rather than waitForLoadState('networkidle'):
      // networkidle will never fire once Supabase Realtime (R-UI-2) opens
      // a persistent WebSocket subscription, so switching now avoids a
      // latent 60s-timeout bug.
      await gotoSettings(a, 'skills');
      await expect(a.getByText('research', { exact: true }).first()).toBeVisible();
      await gotoSettings(b, 'skills');
      await expect(b.getByText('research', { exact: true }).first()).toBeVisible();

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

      // Tab A saves first. Wait for the save to fully settle by checking
      // (a) the state machine returned to viewing (Edit button visible)
      // and (b) the saved value is reflected in the detail view.
      // Deterministic — avoids waitForLoadState('networkidle') which
      // won't fire once Realtime opens a persistent WebSocket.
      await aDesc.fill('A-change');
      await a.getByRole('button', { name: 'Save' }).click();
      await expect(a.getByRole('button', { name: 'Edit' })).toBeVisible();
      await expect(a.getByText('A-change')).toBeVisible();

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
