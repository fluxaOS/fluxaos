// e2e/create-a-skill.spec.ts
// FLX-62 — Skill Create journey: open New Skill form, fill, submit,
// assert row appears in the RecordEditor list. Edit + Delete have
// separate specs (FLX-58 edit-a-skill, delete-an-unreferenced-skill).

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-62 @journey @skill-create', () => {
  test('Skills tab: New Skill round-trips into the list', async ({ page }) => {
    await page.goto(projectPath('/settings/skills'));
    await expect(page.getByRole('heading', { name: 'Skills' })).toBeVisible({
      timeout: 15_000,
    });

    const uniqueName = `Spec Skill ${Date.now()}`;
    const description = 'Spec-created skill — safe to delete.';

    await page.getByRole('button', { name: 'New Skill' }).click();
    await page.getByLabel('Skill name').fill(uniqueName);
    await page.getByLabel('Skill description').fill(description);
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // RecordEditor renders rows as <li> with descriptor.title(s) === s.name.
    const row = page.locator('li', { hasText: uniqueName });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText('global')).toBeVisible();
  });
});
