// e2e/multi-context-switcher.spec.ts
// FLX-1 — context switcher in nav + projects index page.
// Verifies the user can:
//   1. Visit /[org]/[user] and see the projects index listing the seeded
//      project, and click into it.
//   2. Open the nav context switcher popover and see org/user/project
//      lists with the current selection highlighted.
//   3. Click a project entry to navigate (the seeded slug is already
//      selected, so clicking the active one is a no-op — exercise the
//      "all projects" footer link instead).

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-1 @journey @multi-context', () => {
  test('Projects index lists seeded project and links into it', async ({
    page,
  }) => {
    await page.goto('/default/admin');
    await expect(
      page.getByRole('heading', { name: /admin · Projects/i })
    ).toBeVisible({ timeout: 15_000 });
    const grid = page.getByTestId('projects-index-grid');
    await expect(grid).toBeVisible();

    const card = page.getByTestId('project-card-fluxaos');
    await expect(card).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(/\/default\/admin\/fluxaos/);
  });

  test('Nav context switcher opens and shows current selection', async ({
    page,
  }) => {
    await page.goto(projectPath('/'));
    const trigger = page.getByRole('button', { name: 'Switch context' });
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();

    const popover = page.getByTestId('context-switcher-popover');
    await expect(popover).toBeVisible();

    // Each section's active item is rendered with the soft-violet style;
    // assert the seeded slugs are present (text match — the active item
    // and inactive items both render their label in this section).
    await expect(popover.getByText('Default', { exact: true })).toBeVisible();
    await expect(
      popover.getByText('admin', { exact: false }).first()
    ).toBeVisible();
    await expect(
      popover.getByText('fluxaos', { exact: false }).first()
    ).toBeVisible();

    // Footer link navigates to the projects index.
    await popover.getByRole('link', { name: /View all projects/ }).click();
    await expect(page).toHaveURL(/\/default\/admin$/);
  });
});
