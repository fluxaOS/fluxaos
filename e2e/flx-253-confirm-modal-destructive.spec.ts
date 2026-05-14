// e2e/flx-253-confirm-modal-destructive.spec.ts
// FLX-253 — Verify that destructive actions use ConfirmModal (not window.confirm).
//
// Covers two replaced call sites:
//   1. StageEditor — Delete stage button opens ConfirmModal, not a native dialog.
//   2. RecordEditor — Switching record while editing opens ConfirmModal (discard check).
//
// Each test verifies:
//   - Cancel: ConfirmModal appears, cancel leaves the state unchanged.
//   - Confirm: ConfirmModal appears, confirm triggers the action.

import { execSync } from 'node:child_process';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { expect, projectPath, test } from './helpers/setup';

const REPO_ROOT = path.resolve(__dirname, '..');
const env = {
  ...process.env,
  ...loadDotenv({ path: path.join(REPO_ROOT, '.env') }).parsed,
  ...loadDotenv({ path: path.join(REPO_ROOT, '.env.local') }).parsed,
};

test.describe('@flx-253 @confirm-modal @destructive', () => {
  test.beforeAll(() => {
    execSync('npx tsx src/scripts/db/nuke.ts', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env,
    });
    execSync('npm run db:seed', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env,
    });
  });

  // ── StageEditor ────────────────────────────────────────────────────────────

  test('StageEditor: Delete stage — Cancel keeps stage; no native dialog fires', async ({
    page,
  }) => {
    await page.goto(projectPath('/settings'));
    await expect(
      page.getByRole('heading', { name: 'Pipeline settings' })
    ).toBeVisible({ timeout: 15_000 });

    // Expand stages for the first pipeline (Standard Dev).
    const pipeline = page.locator('.card-static', { hasText: 'Standard Dev' });
    await expect(pipeline).toBeVisible({ timeout: 10_000 });
    await pipeline.getByRole('button', { name: 'Stages' }).click();

    // Create a temporary stage to test deletion.
    const stageName = `flx253-cancel-${Date.now()}`;
    await pipeline.getByRole('button', { name: '+ Add Stage' }).click();
    await pipeline.getByPlaceholder('Stage name').fill(stageName);
    await pipeline.getByRole('button', { name: 'Add' }).click();

    const row = pipeline.locator('tr', { hasText: stageName });
    await expect(row).toBeVisible({ timeout: 10_000 });

    // Ensure NO native dialog is triggered — if window.confirm were used,
    // Playwright would auto-dismiss it and the following assertion would fail
    // because the stage would be gone.
    page.on('dialog', () => {
      throw new Error('Native dialog appeared — window.confirm was not replaced');
    });

    // Click Delete → ConfirmModal should appear.
    await row.getByRole('button', { name: 'Delete' }).click();

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal).toContainText(stageName);

    // Click Cancel → stage still present.
    await page.getByTestId('confirm-modal-cancel').click();
    await expect(modal).not.toBeVisible();
    await expect(pipeline.locator('tr', { hasText: stageName })).toBeVisible();

    // Cleanup: now confirm the deletion.
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('confirm-modal-confirm').click();
    await expect(
      pipeline.locator('tr', { hasText: stageName })
    ).toHaveCount(0, { timeout: 10_000 });
  });

  test('StageEditor: Delete stage — Confirm removes stage; no native dialog fires', async ({
    page,
  }) => {
    await page.goto(projectPath('/settings'));
    await expect(
      page.getByRole('heading', { name: 'Pipeline settings' })
    ).toBeVisible({ timeout: 15_000 });

    const pipeline = page.locator('.card-static', { hasText: 'Standard Dev' });
    await expect(pipeline).toBeVisible({ timeout: 10_000 });
    await pipeline.getByRole('button', { name: 'Stages' }).click();

    const stageName = `flx253-confirm-${Date.now()}`;
    await pipeline.getByRole('button', { name: '+ Add Stage' }).click();
    await pipeline.getByPlaceholder('Stage name').fill(stageName);
    await pipeline.getByRole('button', { name: 'Add' }).click();

    const row = pipeline.locator('tr', { hasText: stageName });
    await expect(row).toBeVisible({ timeout: 10_000 });

    page.on('dialog', () => {
      throw new Error('Native dialog appeared — window.confirm was not replaced');
    });

    await row.getByRole('button', { name: 'Delete' }).click();

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal).toContainText(stageName);

    // Confirm → stage gone.
    await page.getByTestId('confirm-modal-confirm').click();
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
    await expect(
      pipeline.locator('tr', { hasText: stageName })
    ).toHaveCount(0, { timeout: 10_000 });
  });

  // ── RecordEditor ───────────────────────────────────────────────────────────

  test('RecordEditor: switch record while editing — Cancel keeps editing; no native dialog fires', async ({
    page,
  }) => {
    // Use the Skills settings page (RecordEditor with multiple records from seed).
    await page.goto(projectPath('/settings/skills'));
    await expect(
      page.getByRole('heading', { name: /skills/i })
    ).toBeVisible({ timeout: 15_000 });

    // Wait for records to load — need at least 2 skills from seed.
    const listItems = page.locator('ul li');
    await expect(listItems).toHaveCount(2, { timeout: 10_000 });

    // Select the first skill.
    const firstItem = listItems.nth(0);
    const secondItem = listItems.nth(1);
    const firstText = await firstItem.locator('.text-sm').innerText();

    await firstItem.click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({
      timeout: 5_000,
    });

    // Enter editing mode.
    await page.getByRole('button', { name: 'Edit' }).click();

    // Verify we're in editing mode.
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();

    page.on('dialog', () => {
      throw new Error('Native dialog appeared — window.confirm was not replaced');
    });

    // Click a different record while in editing mode → ConfirmModal should appear.
    await secondItem.click();

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal).toContainText('Discard');

    // Cancel → still on the first record in editing mode.
    await page.getByTestId('confirm-modal-cancel').click();
    await expect(modal).not.toBeVisible();

    // Should still show Save (still editing).
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();

    // The first record title should still be visible in the detail panel.
    await expect(
      page.locator('h3').filter({ hasText: firstText })
    ).toBeVisible();
  });

  test('RecordEditor: switch record while editing — Confirm discards and switches; no native dialog fires', async ({
    page,
  }) => {
    await page.goto(projectPath('/settings/skills'));
    await expect(
      page.getByRole('heading', { name: /skills/i })
    ).toBeVisible({ timeout: 15_000 });

    const listItems = page.locator('ul li');
    await expect(listItems).toHaveCount(2, { timeout: 10_000 });

    const firstItem = listItems.nth(0);
    const secondItem = listItems.nth(1);
    const secondText = await secondItem.locator('.text-sm').innerText();

    await firstItem.click();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({
      timeout: 5_000,
    });
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();

    page.on('dialog', () => {
      throw new Error('Native dialog appeared — window.confirm was not replaced');
    });

    // Click second record while editing → ConfirmModal.
    await secondItem.click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Confirm → switches to second record, no longer editing.
    await page.getByTestId('confirm-modal-confirm').click();
    await expect(modal).not.toBeVisible({ timeout: 5_000 });

    // Now in viewing mode for the second record.
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.locator('h3').filter({ hasText: secondText })
    ).toBeVisible();
  });
});
