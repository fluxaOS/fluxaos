// e2e/r-mission-control.spec.ts
// R-MISSION-CONTROL journey: validates the operator dashboard.
//
// Case A (always-runs): page renders the four sections + empty states
//   when the project has no runs yet.
// Case B (@daemon @journey, skips without ANTHROPIC_API_KEY): spawns
//   the daemon, triggers a Run-Stage from the UI, then asserts mission
//   control reflects the in-flight transition (Realtime invalidation).

import { type DaemonHandle, spawnDaemon } from './helpers/daemon';
import { resetDb } from './helpers/reset-db';
import { expect, projectPath, test } from './helpers/setup';

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

test.describe('@r-mission-control', () => {
  // Earlier suite specs leave runs/issues behind; the empty states (and the
  // daemon journey below, which drives seed issue #1) require pristine seed
  // state. resetDb preserves operator-owned target_repo_path (FLX-266).
  test.beforeAll(async () => {
    await resetDb();
  });

  test('renders four sections with empty states when nothing is running', async ({
    page,
  }) => {
    await page.goto(projectPath('/mission-control'));

    await expect(
      page.getByRole('heading', { name: 'Mission Control' })
    ).toBeVisible({
      timeout: 15_000,
    });

    // Section headers all render (Title Case per FLX-30/FLX-31 sweep).
    await expect(
      page.getByRole('heading', { name: 'Queue Depth' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'In-Flight Runs' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Recent Terminal Runs' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Recent Pull Requests' })
    ).toBeVisible();

    // Empty-state copies all render (Title Case per FLX-30/FLX-31).
    await expect(
      page.getByText(/Queue Is Empty — Waiting for New Runs/)
    ).toBeVisible();
    await expect(page.getByText(/^No Runs in Flight$/)).toBeVisible();
    await expect(page.getByText(/^No Terminal Runs Yet$/)).toBeVisible();
    await expect(page.getByText(/^No PRs Opened Yet$/)).toBeVisible();
  });
});

test.describe('@r-mission-control @daemon @journey', () => {
  test.skip(!HAS_API_KEY, 'requires ANTHROPIC_API_KEY in environment');
  test.setTimeout(6 * 60_000);

  let handle: DaemonHandle | null = null;

  test.beforeAll(async () => {
    await resetDb();
    handle = await spawnDaemon();
  });

  test.afterAll(async () => {
    if (handle) await handle.shutdown();
  });

  test('mission control reflects daemon-driven transitions', async ({
    page,
  }) => {
    // Trigger a run via the existing UI flow.
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

    // Navigate to mission control.
    await page.goto(projectPath('/mission-control'));
    await expect(
      page.getByRole('heading', { name: 'Mission control' })
    ).toBeVisible({
      timeout: 15_000,
    });

    // The in-flight section should populate as the daemon flips
    // pipeline_run.status pending → running. We assert "No runs in
    // flight" disappears (Realtime invalidation worked). The seeded
    // pipeline ends at a review:hold gate, so the run stays at status
    // running and the in-flight section stays populated — terminal-
    // section coverage is R-SMOKE territory.
    await expect(page.getByText(/^No Runs in Flight$/)).toBeHidden({
      timeout: 30_000,
    });

    // The current-stage badge should show the stage the daemon is
    // executing (one of: launching | running | pending). Using a more
    // permissive selector — any StatusBadge inside an in-flight card
    // is acceptable evidence of daemon-driven progress.
    await expect
      .poll(
        async () =>
          page.locator('[aria-label="Running runs"] span.rounded-full').count(),
        {
          timeout: 60_000,
          intervals: [1_000, 2_000, 5_000],
          message: 'in-flight card never rendered a stage status badge',
        }
      )
      .toBeGreaterThan(0);

    const daemonAlive = handle !== null && handle.daemon.exitCode === null;
    expect(daemonAlive, 'daemon died mid-run').toBe(true);
  });
});
