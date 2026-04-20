// e2e/run-stage-smoke.spec.ts
// Smoke test for R-REM-W2 follow-up fixes:
//   - bootstrap-client.ts must read NEXT_PUBLIC_* via literal member access
//   - stdoutParser must be registered in the client registry
// Fails if the issue detail page or RunDetailModal throws on load/interaction.
import { test, expect, projectPath } from './helpers/setup';

test.describe('@r-rem-w2-followup @smoke', () => {
  test('issue detail page + Run Stage opens RunDetailModal without registry/env errors', async ({ page }) => {
    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];

    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Issue #3 is the only open issue in the seed ("Testing a new issue to edit comment").
    await page.goto(projectPath('/issues/3'));

    // Wait for the issue card to render (has a State <select>).
    await expect(page.getByRole('heading', { name: /Testing a new issue/ })).toBeVisible({
      timeout: 15_000,
    });

    // The "Run Stage" button only renders when the issue's state matches a pipeline
    // stage name. The seeded issue is in state "New", which has no matching stage.
    // Advance to "Research" so `matchingStage` resolves.
    //
    // The State dropdown is built by CatalogSelect — a <div> containing a "State"
    // label span and a <select> whose option VALUES are state UUIDs and option
    // TEXT is the display name. Scope to the div wrapping the "STATE" label text.
    // The CatalogSelect renders a flex container that has a <span> with exact
    // text "State" followed by a CatalogBadge and a <select>. Scope to the
    // container whose direct child span has that exact text.
    const stateSelect = page
      .locator('div.flex.items-center.gap-2', {
        has: page.locator('span', { hasText: /^State$/ }),
      })
      .locator('select');
    await stateSelect.selectOption({ label: 'Research' });

    // Wait for the Run Stage button to appear after the state change persists.
    await expect(page.getByRole('button', { name: /Run Stage/ })).toBeVisible({ timeout: 15_000 });

    // No errors just from loading the page.
    expect(pageErrors, `pageerrors on load: ${pageErrors.map((e) => e.message).join(' | ')}`).toHaveLength(0);

    // Click Run Stage → triggers pipeline.runs.trigger → setActiveRunId → RunDetailModal opens.
    await page.getByRole('button', { name: /Run Stage/ }).click();

    // RunDetailModal renders its header once runId is set.
    // It queries pipeline.runs.getById — wait for the modal's distinguishing UI.
    await expect(page.getByText(/Run Detail|Pipeline Run|Stage Runs/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Key assertion: neither of the R-REM-W2 bugs reappeared.
    const registryMisses = [...pageErrors.map((e) => e.message), ...consoleErrors].filter((msg) =>
      /Adapter ".*" is not registered|Missing required environment variable|Missing Supabase config/.test(msg),
    );
    expect(
      registryMisses,
      `registry/env errors observed: ${registryMisses.join(' | ')}`,
    ).toHaveLength(0);

    // No uncaught React/browser errors at all.
    expect(pageErrors, `pageerrors after Run Stage: ${pageErrors.map((e) => e.message).join(' | ')}`).toHaveLength(0);
  });
});
