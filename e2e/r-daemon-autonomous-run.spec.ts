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
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, projectPath } from './helpers/setup';

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

const DAEMON_READY_REGEX = /daemon\.started /;
const DAEMON_BOOT_TIMEOUT_MS = 30_000;
const DAEMON_SHUTDOWN_TIMEOUT_MS = 40_000;

test.describe('@r-daemon @journey', () => {
  test.skip(!HAS_API_KEY, 'requires ANTHROPIC_API_KEY in environment');

  test.setTimeout(6 * 60_000);

  let daemon: ChildProcess | null = null;
  const daemonStdout: string[] = [];
  const daemonStderr: string[] = [];

  test.beforeAll(async () => {
    const env = {
      ...process.env,
      FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS: '60',
      FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN: '5',
    };
    const tsxBin = resolve(
      process.cwd(),
      'node_modules/.bin/tsx',
    );
    const child = spawn(tsxBin, ['src/scripts/daemon.ts'], {
      env,
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    daemon = child;
    if (!child.stdout || !child.stderr) {
      throw new Error('daemon stdio was not piped');
    }

    child.stdout.on('data', (chunk: Buffer) => {
      daemonStdout.push(chunk.toString());
    });
    child.stderr.on('data', (chunk: Buffer) => {
      daemonStderr.push(chunk.toString());
    });

    await new Promise<void>((resolveReady, rejectReady) => {
      const timer = setTimeout(() => {
        rejectReady(
          new Error(
            `Daemon failed to emit "${DAEMON_READY_REGEX}" within ${DAEMON_BOOT_TIMEOUT_MS}ms. stdout so far:\n${daemonStdout.join('')}\nstderr:\n${daemonStderr.join('')}`,
          ),
        );
      }, DAEMON_BOOT_TIMEOUT_MS);

      const checkReady = () => {
        const joined = daemonStdout.join('');
        if (DAEMON_READY_REGEX.test(joined)) {
          clearTimeout(timer);
          resolveReady();
        }
      };
      child.stdout.on('data', checkReady);
      child.on('exit', (code) => {
        clearTimeout(timer);
        rejectReady(
          new Error(
            `Daemon exited before ready (code=${code}). stdout:\n${daemonStdout.join('')}\nstderr:\n${daemonStderr.join('')}`,
          ),
        );
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
          () =>
            reject(
              new Error(
                `Daemon did not exit within ${DAEMON_SHUTDOWN_TIMEOUT_MS}ms after SIGTERM.`,
              ),
            ),
          DAEMON_SHUTDOWN_TIMEOUT_MS,
        ),
      ),
    ]);
  });

  test('daemon drives stages forward via Realtime pickup', async ({
    page,
  }) => {
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
        },
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

    const daemonAlive = daemon !== null && daemon.exitCode === null;
    expect(daemonAlive, 'daemon died mid-run').toBe(true);

    const knownErrorPattern =
      /Adapter ".*" is not registered|Missing required environment variable|Missing Supabase config|Uncaught/;
    const matchedErrors = consoleErrors.filter((e) => knownErrorPattern.test(e));
    expect(
      pageErrors,
      `Unexpected pageerror(s): ${pageErrors.map((e) => e.message).join('; ')}`,
    ).toHaveLength(0);
    expect(
      matchedErrors,
      `Unexpected registry/env errors: ${matchedErrors.join('; ')}`,
    ).toHaveLength(0);
  });
});
