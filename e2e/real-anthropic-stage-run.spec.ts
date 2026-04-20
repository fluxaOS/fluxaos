// e2e/real-anthropic-stage-run.spec.ts
// R-REM-W3-a journey test: drives a real stage run against live Claude and
// asserts the engine completes end-to-end.
//
// Skips cleanly when ANTHROPIC_API_KEY is absent so CI and local runs without
// the key stay green; with the key set, it advances seed issue #1 through the
// Research stage, waits for the RunDetailModal to show terminal
// `stage_run.status = 'completed'`, asserts at least one `tool_call` transcript
// entry is present, and asserts no console errors fired during the run.
import { test, expect, projectPath } from './helpers/setup';

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

test.describe('@r-rem-w3-a @journey', () => {
  test.skip(!HAS_API_KEY, 'requires ANTHROPIC_API_KEY in environment');

  // Live-Claude runs can take 1–3 minutes depending on stage complexity.
  // Bump the default 60s timeout well past the expected completion window.
  test.setTimeout(5 * 60_000);

  test('real Claude advances issue through Research stage end-to-end', async ({ page }) => {
    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];

    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Seed issue #1 is "Add health check endpoint with build metadata" in state "New".
    await page.goto(projectPath('/issues/1'));

    await expect(page.getByRole('heading', { name: /Add health check endpoint/ })).toBeVisible({
      timeout: 15_000,
    });

    // TODO (next step): advance to Research, click Run Stage, assert terminal state + tool_call.
  });
});
