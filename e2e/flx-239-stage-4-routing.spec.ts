import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-239 @stage-4-routing', () => {
  test('root redirects to a project UUID route and project pages render', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/i);
    await expect(
      page.getByRole('heading', { name: /dashboard/i }).first()
    ).toBeVisible({ timeout: 15_000 });

    await page.goto(projectPath('/issues'));
    await expect(
      page.getByRole('heading', { name: /issues/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('old slug project route is not active', async ({ page }) => {
    await page.goto('/default/admin/fluxaos');
    await expect(
      page.getByText(/This page could not be found/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
