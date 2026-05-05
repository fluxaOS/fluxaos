// e2e/settings-nav-personas-removed.spec.ts
// FLX-129 — Personas tab must be gone from Settings nav; Skills tab must remain.
// Skills edited in the UI must be readable by the orchestrator via the skill
// table (DB-first lookup tested at integration level; this spec verifies the
// UI surface that feeds that table is intact and accessible).

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-129 @journey @settings-nav', () => {
  test('Settings nav: Personas tab is absent, Skills tab is present', async ({
    page,
  }) => {
    await page.goto(projectPath('/settings'));
    await expect(page.getByRole('navigation', { name: 'Settings tabs' })).toBeVisible({
      timeout: 15_000,
    });

    const nav = page.getByRole('navigation', { name: 'Settings tabs' });

    // Personas tab must not exist
    await expect(nav.getByRole('link', { name: 'Personas' })).toHaveCount(0);

    // Skills tab must be present and navigable
    await expect(nav.getByRole('link', { name: 'Skills' })).toBeVisible();
  });

  test('Settings nav: Skills page loads and shows skill list', async ({
    page,
  }) => {
    await page.goto(projectPath('/settings/skills'));
    await expect(
      page.getByRole('heading', { name: 'Skills' })
    ).toBeVisible({ timeout: 15_000 });
    // Seeded skill row (RecordEditor renders rows as <li>)
    await expect(page.locator('li', { hasText: 'research' })).toBeVisible({ timeout: 10_000 });
  });
});
