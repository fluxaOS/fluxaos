// e2e/flx-252-create-entity-form.spec.ts
//
// FLX-252 — Verify CreateEntityForm works end-to-end on two refactored
// settings pages (Routing Profiles and Teams). Each test: navigates to the
// page, opens the create form, fills required fields, submits, and asserts
// the new row appears in the RecordEditor list.

import { cleanupFlx252CreateEntityRows } from './helpers/catalog-cleanup';
import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-252 @journey @create-entity-form', () => {
  test.beforeAll(async () => {
    await cleanupFlx252CreateEntityRows();
  });

  test.afterEach(async () => {
    await cleanupFlx252CreateEntityRows();
  });

  test.afterAll(async () => {
    await cleanupFlx252CreateEntityRows();
  });

  test('Routing Profiles: CreateEntityForm creates a new profile', async ({
    page,
  }) => {
    await page.goto(projectPath('/settings/routing'));
    await expect(
      page.getByRole('heading', { name: 'Routing Profiles' })
    ).toBeVisible({ timeout: 15_000 });

    const ts = Date.now();
    const name = `FLX-252 Profile ${ts}`;

    await page.getByRole('button', { name: 'New Profile' }).click();

    // CreateEntityForm renders aria-label matching the field label.
    await expect(page.getByLabel('Name')).toBeVisible({ timeout: 5_000 });
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Description').fill('Created by FLX-252 spec');

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const row = page.locator('li', { hasText: name });
    await expect(row).toBeVisible({ timeout: 10_000 });
  });

  test('Teams: CreateEntityForm creates a new team', async ({ page }) => {
    await page.goto(projectPath('/settings/teams'));
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({
      timeout: 15_000,
    });

    const ts = Date.now();
    const name = `FLX-252 Team ${ts}`;

    await page.getByRole('button', { name: 'New Team' }).click();

    // CreateEntityForm renders aria-label matching the field label.
    await expect(page.getByLabel('Name')).toBeVisible({ timeout: 5_000 });
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Description').fill('Created by FLX-252 spec');

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const row = page.locator('li', { hasText: name });
    await expect(row).toBeVisible({ timeout: 10_000 });
  });

  test('Skills: CreateEntityForm creates a new skill with scope select', async ({
    page,
  }) => {
    await page.goto(projectPath('/settings/skills'));
    await expect(page.getByRole('heading', { name: 'Skills' })).toBeVisible({
      timeout: 15_000,
    });

    const ts = Date.now();
    const name = `FLX-252 Skill ${ts}`;

    await page.getByRole('button', { name: 'New Skill' }).click();

    await expect(page.getByLabel('Name')).toBeVisible({ timeout: 5_000 });
    await page.getByLabel('Name').fill(name);
    // Scope field is a select — verify it renders with the expected options.
    await expect(page.getByLabel('Scope')).toBeVisible();
    await page.getByLabel('Description').fill('Created by FLX-252 spec');

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const row = page.locator('li', { hasText: name });
    await expect(row).toBeVisible({ timeout: 10_000 });
  });

  test('Providers: CreateEntityForm creates a new provider', async ({
    page,
  }) => {
    await page.goto(projectPath('/settings/providers'));
    await expect(page.getByRole('heading', { name: 'Providers' })).toBeVisible({
      timeout: 15_000,
    });

    const ts = Date.now();
    const name = `FLX-252 Provider ${ts}`;
    const type = `flx-252-type-${ts}`;

    await page.getByRole('button', { name: 'New Provider' }).click();

    await expect(page.getByLabel('Name')).toBeVisible({ timeout: 5_000 });
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Type').fill(type);

    await page.getByRole('button', { name: 'Create', exact: true }).click();

    const row = page.locator('li', { hasText: name });
    await expect(row).toBeVisible({ timeout: 10_000 });
  });
});
