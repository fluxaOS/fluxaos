import { resetDb } from './helpers/reset-db';
import { expect, projectPath, test } from './helpers/setup';

test.describe('@dogfood @pipeline-stage-crud', () => {
  test.beforeAll(async () => {
    await resetDb();
  });

  test('operator can edit and delete a pipeline stage', async ({ page }) => {
    await page.goto(projectPath('/settings'));
    await expect(
      page.getByRole('heading', { name: 'Pipeline settings' })
    ).toBeVisible({ timeout: 15_000 });

    const pipeline = page.locator('.card-static', { hasText: 'Standard Dev' });
    await expect(pipeline).toBeVisible({ timeout: 10_000 });
    await pipeline.getByRole('button', { name: 'Stages' }).click();
    await expect(pipeline.locator('tr', { hasText: 'research' })).toBeVisible({
      timeout: 10_000,
    });

    const ts = Date.now();
    const stageName = `dogfood-stage-${ts}`;
    const updatedStageName = `dogfood-stage-updated-${ts}`;

    await pipeline.getByRole('button', { name: '+ Add Stage' }).click();
    await pipeline.getByPlaceholder('Stage name').fill(stageName);
    await pipeline.getByRole('button', { name: 'Add' }).click();

    const row = pipeline.locator('tr', { hasText: stageName });
    await expect(row).toBeVisible({ timeout: 10_000 });

    await row.getByRole('button', { name: 'Edit' }).click();
    await pipeline.getByLabel('Stage name').fill(updatedStageName);
    await pipeline.getByRole('button', { name: 'Save' }).click();

    const updatedRow = pipeline.locator('tr', { hasText: updatedStageName });
    await expect(updatedRow).toBeVisible({ timeout: 10_000 });

    // FLX-253: destructive actions use ConfirmModal, not window.confirm.
    await updatedRow.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('confirm-modal-confirm').click();
    await expect(
      pipeline.locator('tr', { hasText: updatedStageName })
    ).toHaveCount(0, { timeout: 10_000 });
  });
});
