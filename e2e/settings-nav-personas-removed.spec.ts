// e2e/settings-nav-personas-removed.spec.ts
// FLX-129 — Settings nav surface: Skills tab is present; Personas tab was
// removed then restored (FLX-153 follow-up) — both tabs coexist.
// Skills edited in the UI must be readable by the orchestrator via the skill
// table (DB-first lookup tested at integration level; this spec verifies the
// UI surface that feeds that table is intact and accessible).

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-129 @journey @settings-nav', () => {
  test('Settings nav: Skills tab is present and navigable', async ({
    page,
  }) => {
    await page.goto(projectPath('/settings'));
    await expect(page.getByRole('navigation', { name: 'Settings tabs' })).toBeVisible({
      timeout: 15_000,
    });

    const nav = page.getByRole('navigation', { name: 'Settings tabs' });

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
