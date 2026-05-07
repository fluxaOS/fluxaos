// e2e/pipeline-db-routing.spec.ts
// FLX-153 / FLX-129 — DB-first routing: verify the UI surface reflects the
// new pipeline schema: persona picker + routing fields (onPass/onFail/fallback)
// in stage editor, Personas tab in settings nav, and seeded personas visible.

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-153 @flx-129 @journey @pipeline-db-routing', () => {
  test('Settings nav: Personas tab is visible', async ({ page }) => {
    await page.goto(projectPath('/settings'));
    await expect(
      page.getByRole('navigation', { name: 'Settings tabs' })
    ).toBeVisible({ timeout: 15_000 });

    const nav = page.getByRole('navigation', { name: 'Settings tabs' });

    // Personas tab must be present (restored in FLX-129 follow-up)
    await expect(nav.getByRole('link', { name: 'Personas' })).toBeVisible();

    // Click it and assert navigation to /settings/personas
    await nav.getByRole('link', { name: 'Personas' }).click();
    await page.waitForURL(/\/settings\/personas/, { timeout: 10_000 });

    // Personas page must render a heading
    await expect(page.getByRole('heading', { name: 'Personas' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('Personas page: seeded personas are visible', async ({ page }) => {
    await page.goto(projectPath('/settings/personas'));
    await expect(page.getByRole('heading', { name: 'Personas' })).toBeVisible({
      timeout: 15_000,
    });

    // Seed data creates at least Research Analyst, Software Engineer,
    // Code Reviewer, Release Engineer — assert at least one li is visible.
    const rows = page.locator('li');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('Stage editor: persona picker and routing fields visible, no Skill picker', async ({
    page,
  }) => {
    await page.goto(projectPath('/settings'));
    await expect(
      page.getByRole('heading', { name: /Pipeline [Ss]ettings/ })
    ).toBeVisible({ timeout: 15_000 });

    // Find the Standard Dev pipeline card and expand its stage list
    const pipeline = page.locator('.card-static', { hasText: 'Standard Dev' });
    await expect(pipeline).toBeVisible({ timeout: 10_000 });
    await pipeline.getByRole('button', { name: 'Stages' }).click();

    // Seeded pipeline has a "research" stage — wait for it to appear
    await expect(pipeline.locator('tr', { hasText: 'research' })).toBeVisible({
      timeout: 10_000,
    });

    // Click Edit on the research stage row
    const researchRow = pipeline.locator('tr', { hasText: 'research' });
    await researchRow.getByRole('button', { name: 'Edit' }).click();

    // Assert Persona select is visible (aria-label="Persona")
    await expect(
      pipeline.getByRole('combobox', { name: 'Persona' })
    ).toBeVisible({ timeout: 10_000 });

    // Assert routing fields are visible
    await expect(
      pipeline.getByRole('textbox', { name: 'On pass' })
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      pipeline.getByRole('textbox', { name: 'On fail' })
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      pipeline.getByRole('textbox', { name: 'Fallback' })
    ).toBeVisible({ timeout: 5_000 });

    // Assert NO Skill picker is present — this was removed in FLX-153.
    // The form uses Driver (not Skill) for execution config.
    await expect(pipeline.getByRole('combobox', { name: 'Skill' })).toHaveCount(
      0
    );
  });
});
