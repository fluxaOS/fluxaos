// e2e/toggle-driver-enabled.spec.ts
import { test, expect, gotoSettings } from './helpers/setup';

test.describe('@r-ui-1 @settings @drivers', () => {
  test('toggle-driver-enabled', async ({ page }) => {
    await gotoSettings(page, 'drivers');

    const row = page.locator('li', { hasText: 'Claude Code' }).first();
    const toggle = row.locator('label').first();

    // Toggle OFF
    await toggle.click();
    await page.reload();

    // After reload the toggle state should persist — read the inner indicator position
    const indicator = page
      .locator('li', { hasText: 'Claude Code' })
      .first()
      .locator('label')
      .first()
      .locator('span > span');
    // When enabled=false, indicator sits left (translate-x-0.5); when true, right (translate-x-5)
    await expect(indicator).toHaveClass(/translate-x-0\.5/);

    // Toggle back ON
    await page.locator('li', { hasText: 'Claude Code' }).first().locator('label').first().click();
    await page.reload();
    await expect(indicator).toHaveClass(/translate-x-5/);
  });
});
