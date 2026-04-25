// e2e/r-mission-control.spec.ts
// R-MISSION-CONTROL journey: validates the operator dashboard.
//
// Case A (always-runs): page renders the four sections + empty states
//   when the project has no runs yet.
// Case B (@daemon @journey, skips without ANTHROPIC_API_KEY): spawns
//   the daemon, triggers a Run-Stage from the UI, then asserts mission
//   control reflects the in-flight transition (Realtime invalidation).
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, projectPath } from './helpers/setup';

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;
const DAEMON_READY_REGEX = /daemon\.started /;
const DAEMON_BOOT_TIMEOUT_MS = 30_000;
// Must exceed FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS below; otherwise the
// daemon is still draining a mid-flight stage when the test gives up.
const DAEMON_SHUTDOWN_TIMEOUT_MS = 90_000;

test.describe('@r-mission-control', () => {
  test('renders four sections with empty states when nothing is running', async ({ page }) => {
    await page.goto(projectPath('/mission-control'));

    await expect(page.getByRole('heading', { name: 'Mission control' })).toBeVisible({
      timeout: 15_000,
    });

    // Section headers all render.
    await expect(page.getByRole('heading', { name: 'Queue depth' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'In-flight runs' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent terminal runs' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent pull requests' })).toBeVisible();

    // Empty-state copies all render (verbatim from spec §R4).
    await expect(page.getByText(/Queue is empty — waiting for new runs/)).toBeVisible();
    await expect(page.getByText(/^No runs in flight$/)).toBeVisible();
    await expect(page.getByText(/^No terminal runs yet$/)).toBeVisible();
    await expect(page.getByText(/^No PRs opened yet$/)).toBeVisible();
  });
});

test.describe('@r-mission-control @daemon @journey', () => {
  test.skip(!HAS_API_KEY, 'requires ANTHROPIC_API_KEY in environment');
  test.setTimeout(6 * 60_000);

  let daemon: ChildProcess | null = null;
  const daemonStdout: string[] = [];

  test.beforeAll(async () => {
    const env = {
      ...process.env,
      FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS: '60',
      FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN: '5',
    };
    const tsxBin = resolve(process.cwd(), 'node_modules/.bin/tsx');
    const child = spawn(tsxBin, ['src/scripts/daemon.ts'], {
      env,
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    daemon = child;
    if (!child.stdout) throw new Error('daemon stdio was not piped');

    child.stdout.on('data', (chunk: Buffer) => {
      daemonStdout.push(chunk.toString());
    });

    await new Promise<void>((resolveReady, rejectReady) => {
      const timer = setTimeout(() => {
        rejectReady(new Error(`Daemon did not emit ready within ${DAEMON_BOOT_TIMEOUT_MS}ms`));
      }, DAEMON_BOOT_TIMEOUT_MS);
      const checkReady = () => {
        if (DAEMON_READY_REGEX.test(daemonStdout.join(''))) {
          clearTimeout(timer);
          resolveReady();
        }
      };
      child.stdout.on('data', checkReady);
      child.on('exit', (code) => {
        clearTimeout(timer);
        rejectReady(new Error(`Daemon exited before ready (code=${code})`));
      });
    });
  });

  test.afterAll(async () => {
    if (!daemon) return;
    const d = daemon;
    const exited = new Promise<void>((resolveExit) => {
      d.on('exit', () => resolveExit());
    });
    d.kill('SIGTERM');
    await Promise.race([
      exited,
      new Promise<void>((_r, reject) =>
        setTimeout(
          () => reject(new Error(`Daemon did not exit within ${DAEMON_SHUTDOWN_TIMEOUT_MS}ms`)),
          DAEMON_SHUTDOWN_TIMEOUT_MS,
        ),
      ),
    ]);
  });

  test('mission control reflects daemon-driven transitions', async ({ page }) => {
    // Trigger a run via the existing UI flow.
    await page.goto(projectPath('/issues/1'));
    await expect(
      page.getByRole('heading', { name: /Add health check endpoint/ }),
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
    await expect(page.getByRole('heading', { name: 'Mission control' })).toBeVisible({
      timeout: 15_000,
    });

    // The in-flight section should populate as the daemon flips
    // pipeline_run.status pending → running. We assert "No runs in
    // flight" disappears (Realtime invalidation worked). The seeded
    // pipeline ends at a review:hold gate, so the run stays at status
    // running and the in-flight section stays populated — terminal-
    // section coverage is R-SMOKE territory.
    await expect(page.getByText(/^No runs in flight$/)).toBeHidden({ timeout: 30_000 });

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
        },
      )
      .toBeGreaterThan(0);

    const daemonAlive = daemon !== null && daemon.exitCode === null;
    expect(daemonAlive, 'daemon died mid-run').toBe(true);
  });
});
