// e2e/toggle-driver-enabled.spec.ts
// The journey verifies that toggling persists across reload. Tests cannot
// assume a specific starting state (prior runs may have left the toggle
// off), so the assertions track the state delta: whichever state we start
// in, one click must flip to the opposite and survive reload; a second
// click must return to the original and survive reload.
import { expect, gotoSettings, test } from './helpers/setup';

test.describe('@r-ui-1 @settings @drivers', () => {
  test('toggle-driver-enabled', async ({ page }) => {
    await gotoSettings(page, 'drivers');

    const indicator = () =>
      page
        .locator('li', { hasText: 'Claude Code' })
        .first()
        .locator('label')
        .first()
        .locator('span > span');

    const isEnabledNow = async (): Promise<boolean> => {
      const cls = (await indicator().getAttribute('class')) ?? '';
      return cls.includes('translate-x-5');
    };

    // Capture the starting state (ON = translate-x-5, OFF = translate-x-0.5)
    const startEnabled = await isEnabledNow();
    const opposite = !startEnabled;
    const oppositeClass = opposite ? /translate-x-5/ : /translate-x-0\.5/;
    const startClass = startEnabled ? /translate-x-5/ : /translate-x-0\.5/;

    // First click — flip to opposite state, wait for mutation to land,
    // reload, confirm persisted. The toggle's onClick fires handleToggle
    // asynchronously without an await-point Playwright can see, so we must
    // wait for the tRPC POST response explicitly before reloading —
    // otherwise reload races the mutation and the UI shows the old state.
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/trpc/driver.update') &&
          r.request().method() === 'POST'
      ),
      page
        .locator('li', { hasText: 'Claude Code' })
        .first()
        .locator('label')
        .first()
        .click(),
    ]);
    await page.reload();
    await expect(indicator()).toHaveClass(oppositeClass);

    // Second click — flip back, wait for mutation, reload, confirm
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/trpc/driver.update') &&
          r.request().method() === 'POST'
      ),
      page
        .locator('li', { hasText: 'Claude Code' })
        .first()
        .locator('label')
        .first()
        .click(),
    ]);
    await page.reload();
    await expect(indicator()).toHaveClass(startClass);
  });
});
