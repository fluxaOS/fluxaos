// e2e/full-issue-lifecycle.spec.ts
//
// CANONICAL FULL-LIFECYCLE JOURNEY TEST.
//
// What a human does:
//   1. Open the app in a browser (already running, with whatever env the
//      daemon was booted with).
//   2. Click "New Issue", type a title + description, click Create.
//   3. Watch the Pipeline Run section update from pending → running →
//      completed as the orchestrator executes every stage.
//
// This spec replays exactly that. It connects to whatever daemon is serving
// `PLAYWRIGHT_BASE_URL` (the same one the operator clicks). It does NOT
// spawn its own daemon. It does NOT require any FLUXAOS_* env vars in the
// test process — secrets live with the daemon, the same way they do for a
// human.
//
// If the app isn't reachable, the test fails loudly. If the pipeline does
// not reach `completed` within the timeout, the test fails loudly. There
// are no skip conditions: this test must pass before any UI sign-off.

import { expect, projectPath, test } from './helpers/setup';

const TERMINAL_TIMEOUT_MS = 5 * 60_000; // live Claude can take 1–3 min/stage

test.describe('@journey @full-lifecycle', () => {
  // Boot redirect + run-to-terminal + buffer.
  test.setTimeout(TERMINAL_TIMEOUT_MS + 60_000);

  test('filing an issue runs the pipeline through every stage to completed', async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    // ── 1. Create a new issue via the UI ─────────────────────────────────
    await page.goto(projectPath('/issues/new'));

    await expect(page.getByRole('heading', { name: 'New Issue' })).toBeVisible({
      timeout: 15_000,
    });

    const uniqueTitle = `Full lifecycle ${Date.now()}`;
    await page.getByPlaceholder('Issue title').fill(uniqueTitle);
    await page
      .getByPlaceholder('Describe the issue (Markdown)')
      .fill(
        'Canonical full-lifecycle journey test. Add a one-line note to README acknowledging this run.'
      );

    await page.getByRole('button', { name: /Create Issue/ }).click();

    // Redirects to the issue detail page.
    await expect(
      page.getByRole('heading', { name: new RegExp(uniqueTitle) })
    ).toBeVisible({ timeout: 15_000 });

    // ── 2. Watch the Pipeline Run section update to terminal ─────────────
    // The issue detail page renders "Run: {status} · Cost: $..." once the
    // IssueWatcher has dispatched a pipeline_run. We poll that text until
    // it reads "completed" — the terminal happy-path status. The deploy
    // hook may flip the run to `failed` afterwards if the daemon is not
    // configured for deploy; that is a separate concern. The pipeline
    // itself reaching `completed` is what this test asserts.
    const runStatus = page.locator('p', { hasText: /^Run:\s/ }).first();

    await expect
      .poll(
        async () => {
          await page.reload();
          const text = await runStatus.textContent().catch(() => null);
          if (!text) return null;
          // "Run: completed · Cost: $..." → "completed"
          const match = text.match(/Run:\s*(\w+)/);
          return match?.[1] ?? null;
        },
        {
          timeout: TERMINAL_TIMEOUT_MS,
          intervals: [2_000, 5_000, 10_000],
          message:
            'Pipeline did not reach `completed` within timeout. ' +
            'Check daemon logs and `npm run db:runs` for the failing stage.',
        }
      )
      .toBe('completed');

    // No page errors during the run.
    expect(
      pageErrors,
      `Unexpected pageerror(s): ${pageErrors.map((e) => e.message).join('; ')}`
    ).toHaveLength(0);
  });
});
