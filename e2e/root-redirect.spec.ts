import { expect, test } from './helpers/setup';

test.describe('@root-redirect @journey', () => {
  test('GET / redirects to seeded project dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/default\/admin\/fluxaos/, {
      timeout: 15_000,
    });
  });
});
