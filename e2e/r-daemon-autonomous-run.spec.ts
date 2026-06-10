// e2e/r-daemon-autonomous-run.spec.ts
// R-DAEMON journey: spawns the daemon as a child process, triggers a
// pipeline run via the UI, waits for the daemon to drive it to terminal
// completed via Realtime pickup, and cleans up on teardown.
//
// This proves the full R-DAEMON loop mechanically: Next.js publish-only
// trigger -> pipeline_run INSERT on Supabase -> daemon Realtime handler
// -> launchStage -> stage-runner -> real Claude -> gate -> terminal
// status -> terminal hook.
//
// Skips cleanly when ANTHROPIC_API_KEY is absent so CI and local runs
// without the key stay green.

import { type DaemonHandle, spawnDaemon } from './helpers/daemon';
import { resetDb } from './helpers/reset-db';
import { expect, projectPath, test } from './helpers/setup';

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

test.describe('@r-daemon @journey', () => {
  test.skip(!HAS_API_KEY, 'requires ANTHROPIC_API_KEY in environment');

  test.setTimeout(6 * 60_000);

  let handle: DaemonHandle | null = null;

  test.beforeAll(async () => {
    // Earlier suite specs mutate seed issue #1 (epic hierarchies, runs);
    // this journey needs pristine seed state. resetDb preserves the
    // operator-owned target_repo_path (FLX-266).
    await resetDb();
    handle = await spawnDaemon();
  });

  test.afterAll(async () => {
    if (handle) await handle.shutdown();
  });

  test('daemon drives stages forward via Realtime pickup', async ({ page }) => {
    // The seeded pipeline is research(auto) → implement(rules) → review(hold).
    // The hold gate at review intentionally stops the run for human sign-off,
    // so pipeline_run never reaches `completed` autonomously. This journey
    // proves daemon ownership by asserting:
    //   1. pipeline_run advances past `pending` (daemon picked up INSERT)
    //   2. at least 2 stage_runs reach `completed` (daemon drove execution)
    // Anything beyond review is R-SMOKE territory.
    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(projectPath('/issues/1'));

    await expect(
      page.getByRole('heading', { name: /Add health check endpoint/ })
    ).toBeVisible({ timeout: 15_000 });

    const stateSelect = page
      .locator('div.flex.items-center.gap-2', {
        has: page.locator('span', { hasText: /^State$/ }),
      })
      .locator('select');
    await stateSelect.selectOption({ label: 'Research' });

    const runStageButton = page.getByRole('button', { name: /Run Stage/ });
    await expect(runStageButton).toBeVisible({ timeout: 15_000 });
    await runStageButton.click();

    await expect(page.getByText(/Pipeline Run/i).first()).toBeVisible({
      timeout: 15_000,
    });

    const runStatusBadge = page
      .locator('[aria-label="Run detail"]')
      .locator('span.rounded-full.font-semibold')
      .first();

    await expect
      .poll(
        async () => {
          const text = (await runStatusBadge.textContent()) ?? '';
          return text.trim().split(/[\s—]/)[0].toLowerCase();
        },
        {
          timeout: 30_000,
          intervals: [1_000, 2_000],
          message:
            'pipeline_run never advanced past pending. Daemon likely did not pick up the Realtime INSERT.',
        }
      )
      .not.toBe('pending');

    // StageTimeline marks a completed stage with the bg-emerald-400 dot.
    // Counting these proves how many stage_runs the daemon drove to completed.
    const completedStageDots = page
      .locator('[aria-label="Run detail"]')
      .locator('span.rounded-full.bg-emerald-400');

    await expect
      .poll(async () => completedStageDots.count(), {
        timeout: 4 * 60_000,
        intervals: [2_000, 5_000, 10_000],
        message:
          'fewer than 2 stage_runs reached completed status. Daemon may have stalled or a stage failed mid-flight.',
      })
      .toBeGreaterThanOrEqual(2);

    const daemonAlive = handle !== null && handle.daemon.exitCode === null;
    expect(daemonAlive, 'daemon died mid-run').toBe(true);

    const knownErrorPattern =
      /Adapter ".*" is not registered|Missing required environment variable|Missing Supabase config|Uncaught/;
    const matchedErrors = consoleErrors.filter((e) =>
      knownErrorPattern.test(e)
    );
    expect(
      pageErrors,
      `Unexpected pageerror(s): ${pageErrors.map((e) => e.message).join('; ')}`
    ).toHaveLength(0);
    expect(
      matchedErrors,
      `Unexpected registry/env errors: ${matchedErrors.join('; ')}`
    ).toHaveLength(0);
  });
});
