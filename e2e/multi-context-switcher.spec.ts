// e2e/multi-context-switcher.spec.ts
// FLX-1 — context switcher in nav.
// FLX-239 Stage 7 (FLX-266): rewritten for UUID-only routing. The old
// /[org]/[user] projects index and the org/user popover sections are gone;
// the switcher now surfaces the current project (resolved from the
// /p/{projectUuid} URL), lists the org's projects, and links to
// Settings → Projects for management.

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-1 @journey @multi-context', () => {
  test('Nav context switcher shows current project and manages projects', async ({
    page,
  }) => {
    await page.goto(projectPath('/'));
    const trigger = page.getByRole('button', { name: 'Switch context' });
    await expect(trigger).toBeVisible({ timeout: 15_000 });

    // The trigger surfaces the current project's display name, resolved
    // from the URL UUID — not from the first DB row.
    await expect(trigger).toContainText('fluxaOS');

    await trigger.click();
    const popover = page.getByTestId('context-switcher-popover');
    await expect(popover).toBeVisible();

    // The popover lists the org's projects with the current one active.
    await expect(
      popover.getByRole('link', { name: 'fluxaOS' }).first()
    ).toBeVisible();

    // Footer link navigates to Settings → Projects under the same
    // project UUID (management surface for create/switch).
    await popover.getByRole('link', { name: /Manage projects/ }).click();
    await expect(page).toHaveURL(/\/settings\/projects$/, {
      timeout: 15_000,
    });
    await expect(
      page.getByRole('heading', { name: 'Projects', exact: true })
    ).toBeVisible({ timeout: 15_000 });
  });

  test('Clicking the active project entry stays on the project route', async ({
    page,
  }) => {
    await page.goto(projectPath('/issues'));
    const trigger = page.getByRole('button', { name: 'Switch context' });
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.click();

    const popover = page.getByTestId('context-switcher-popover');
    await expect(popover).toBeVisible();

    // Switching to the (already active) seeded project preserves the
    // project-relative route suffix.
    await popover.getByRole('link', { name: 'fluxaOS' }).first().click();
    await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}\/issues$/i, {
      timeout: 15_000,
    });
  });
});
