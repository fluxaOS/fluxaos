// e2e/auto-dispatch.spec.ts
// FLX-193 journey: verifies that filing an issue auto-dispatches a pipeline_run.
//
// The IssueWatcher subscribes to Realtime on the `issue` table. When an issue
// is created with status "open" and the project has a defaultPipelineId, the
// watcher inserts a pipeline_run at status=pending. This test:
//   1. Spins up the daemon (which runs the IssueWatcher).
//   2. Creates a new issue via the UI.
//   3. Waits up to 10s for a pipeline run to appear on the issue's detail page.
//   4. Asserts the run exists at any non-null status.
//
// The test does NOT wait for the run to complete — only that auto-dispatch
// fired within the timeout.
//
// Skips cleanly when ANTHROPIC_API_KEY is absent (daemon can boot without it
// but the IssueWatcher only dispatches; no actual stage execution required for
// this assertion).

import { type DaemonHandle, spawnDaemon } from './helpers/daemon';
import { expect, projectPath, test } from './helpers/setup';

// Auto-dispatch only fires when the daemon is running (IssueWatcher lives in
// the daemon process). We require it.
const SKIP_REASON =
  !process.env.FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS &&
  !process.env.ANTHROPIC_API_KEY
    ? 'requires daemon-capable environment (set ANTHROPIC_API_KEY or FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS)'
    : null;

test.describe('@flx-193 @journey @auto-dispatch', () => {
  // Boot timeout + 10s dispatch wait + buffer.
  test.setTimeout(90_000);

  let handle: DaemonHandle | null = null;

  test.beforeAll(async () => {
    handle = await spawnDaemon({
      // Minimal cleanup thresholds for test environment.
      cleanupSweepIntervalMin: 60,
      cleanupStaleDays: 1,
      cleanupSessionRetentionDays: 1,
      cleanupArtifactsRetentionDays: 1,
    });
  });

  test.afterAll(async () => {
    if (handle) await handle.shutdown();
  });

  test('filing an issue auto-dispatches a pipeline_run', async ({ page }) => {
    if (SKIP_REASON) {
      test.skip(true, SKIP_REASON);
      return;
    }

    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    // ── 1. Create a new issue via the UI ─────────────────────────────────
    await page.goto(projectPath('/issues/new'));

    await expect(page.getByRole('heading', { name: 'New Issue' })).toBeVisible({
      timeout: 15_000,
    });

    const uniqueTitle = `Auto-Dispatch Test ${Date.now()}`;
    await page.getByPlaceholder('Issue title').fill(uniqueTitle);
    await page
      .getByPlaceholder('Describe the issue (Markdown)')
      .fill('Automated e2e test for FLX-193 auto-dispatch.');

    await page.getByRole('button', { name: /Create Issue/ }).click();

    // Redirects to the issue detail page.
    await expect(
      page.getByRole('heading', { name: new RegExp(uniqueTitle) })
    ).toBeVisible({ timeout: 15_000 });

    // Extract the issue number from the URL so we can clean up later.
    const issueUrl = page.url();
    const issueNumber = issueUrl.match(/\/issues\/(\d+)$/)?.[1];
    expect(issueNumber).toBeTruthy();

    // ── 2. Wait for a pipeline run to appear ─────────────────────────────
    // The IssueWatcher fires on the Realtime INSERT. It inserts a
    // pipeline_run at status=pending. The issue detail page shows run
    // status via the RunStage button area or the mission-control panel.
    // We poll the mission control page (which lists runs by project) to
    // confirm a run row appeared for this issue.
    //
    // Alternatively, check the issue detail page for the pipeline run
    // indicator text (status badge rendered in the sidebar or run section).

    // Poll: look for any pipeline run status indicator on the issue page.
    // The issue detail renders a "Pipeline Run" section once a run exists.
    await expect
      .poll(
        async () => {
          // Reload to pick up Realtime updates if the page doesn't subscribe.
          await page.reload();
          const runIndicator = page.getByText(/Pipeline Run/i).first();
          return runIndicator.isVisible().catch(() => false);
        },
        {
          timeout: 10_000,
          intervals: [1_000, 2_000],
          message:
            'No pipeline run appeared on the issue detail page within 10s. ' +
            'IssueWatcher may not have dispatched or daemon may not be running.',
        }
      )
      .toBe(true);

    // ── 3. Assert the run has a non-null status ───────────────────────────
    // Any status (pending, running, completed, etc.) proves dispatch fired.
    const runStatusBadge = page
      .locator('span.rounded-full.font-semibold')
      .first();

    const statusText = await runStatusBadge.textContent().catch(() => null);
    expect(
      statusText,
      'pipeline run status badge should have text'
    ).toBeTruthy();

    // ── 4. Cleanup — delete the test issue ───────────────────────────────
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: /Delete Issue/ }).click();
    await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible({
      timeout: 15_000,
    });

    // No page errors during the test.
    expect(
      pageErrors,
      `Unexpected pageerror(s): ${pageErrors.map((e) => e.message).join('; ')}`
    ).toHaveLength(0);
  });
});
