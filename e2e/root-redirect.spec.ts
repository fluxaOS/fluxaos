import { expect, test } from './helpers/setup';

test.describe('@root-redirect @journey', () => {
  test('GET / redirects to seeded project dashboard', async ({ page }) => {
    await page.goto('/');
    // FLX-239: UUID-only routing — root lands on the seeded project's
    // /p/{uuid} dashboard (deterministic seed UUID).
    await expect(page).toHaveURL(
      new RegExp(`/p/${process.env.FLUXAOS_PROJECT_ID}$`),
      { timeout: 15_000 }
    );
  });
});
