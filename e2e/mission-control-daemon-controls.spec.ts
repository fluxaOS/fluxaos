// e2e/mission-control-daemon-controls.spec.ts
// Journey: Mission Control shows daemon controls with correct state-driven
// button availability. Does not actually start/stop the daemon — only
// verifies the UI surface and button enable/disable logic.

import { expect, projectPath, test } from './helpers/setup';

test.describe('@journey @daemon-controls @mission-control', () => {
  test('Daemon controls are visible on Mission Control', async ({ page }) => {
    await page.goto(projectPath('/mission-control'));
    await expect(
      page.getByRole('heading', { name: 'Mission Control' })
    ).toBeVisible({ timeout: 15_000 });

    // Status indicator must be present
    await expect(
      page.getByRole('button', { name: 'Start', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Restart', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Drain', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Stop', exact: true })
    ).toBeVisible();
  });

  test('Daemon controls: button availability matches stopped/unknown state', async ({
    page,
  }) => {
    await page.goto(projectPath('/mission-control'));
    await expect(
      page.getByRole('heading', { name: 'Mission Control' })
    ).toBeVisible({ timeout: 15_000 });

    // Give the status query time to resolve
    await page.waitForTimeout(4_000);

    const startBtn = page.getByRole('button', { name: 'Start', exact: true });
    const restartBtn = page.getByRole('button', {
      name: 'Restart',
      exact: true,
    });
    const drainBtn = page.getByRole('button', { name: 'Drain', exact: true });
    const stopBtn = page.getByRole('button', { name: 'Stop', exact: true });

    // When daemon is stopped or unknown, Start is enabled; others disabled
    const statusText = await page
      .locator('span')
      .filter({ hasText: /Running|Stopped|Unknown|Draining/ })
      .first()
      .textContent();

    if (statusText?.includes('Running')) {
      // Running: Start disabled, rest enabled
      await expect(startBtn).toBeDisabled();
      await expect(restartBtn).toBeEnabled();
      await expect(drainBtn).toBeEnabled();
      await expect(stopBtn).toBeEnabled();
    } else {
      // Stopped/Unknown: Start enabled, rest disabled
      await expect(startBtn).toBeEnabled();
      await expect(restartBtn).toBeDisabled();
      await expect(drainBtn).toBeDisabled();
      await expect(stopBtn).toBeDisabled();
    }
  });
});
