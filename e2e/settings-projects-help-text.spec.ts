// e2e/settings-projects-help-text.spec.ts
// FLX-208 — Help text on /settings/projects.
//
// RecordField renders descriptor.helpText below the input as a muted
// sub-label, keyed by data-testid="help-<fieldKey>". The projects
// descriptor sets helpText on `defaultPipelineName` and `targetRepoPath`
// — both readonly fields, so the helpText shows in the default viewing
// state without entering edit mode. This spec asserts the testids are
// rendered with the configured copy after selecting a row.

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-208 @journey @settings-projects-help-text', () => {
  test('Projects detail panel shows helpText sub-labels for targetRepoPath + defaultPipelineName', async ({
    page,
  }) => {
    await page.goto(projectPath('/settings/projects'));
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible({
      timeout: 15_000,
    });

    // The seeded project (slug = "fluxaos") is the canonical row — the
    // route path itself uses it. Click it to open the RecordEditor
    // detail panel; helpText renders in viewing mode for readonly fields.
    const seededRow = page.locator('li', { hasText: 'fluxaOS' }).first();
    await expect(seededRow).toBeVisible({ timeout: 10_000 });
    await seededRow.click();

    // Both descriptor.helpText values render via RecordField's
    // helpTextNode (data-testid="help-<fieldKey>"). No edit click needed
    // — the sub-label shows in the default viewing state for both readonly
    // and select-id fields.
    const targetRepoHelp = page.getByTestId('help-targetRepoPath');
    await expect(targetRepoHelp).toBeVisible({ timeout: 5_000 });
    await expect(targetRepoHelp).toContainText('Absolute path');
    await expect(targetRepoHelp).toContainText('isolation worktree');

    // FLX-207 renamed this field from `defaultPipelineName` (readonly) to
    // `defaultPipelineId` (select-id). The testid follows the field key.
    const defaultPipelineHelp = page.getByTestId('help-defaultPipelineId');
    await expect(defaultPipelineHelp).toBeVisible();
    await expect(defaultPipelineHelp).toContainText('Pipeline used when');
  });
});
