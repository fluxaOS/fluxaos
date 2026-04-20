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

    // The Run Stage button only renders when the issue's state matches a
    // pipeline stage name. Seeded state is "New"; advance to "Research" so
    // the orchestrator's `matchingStage` resolves.
    //
    // The State dropdown is built by CatalogSelect — a flex row containing a
    // <span>State</span> label, a CatalogBadge, and a <select> whose option
    // VALUES are state UUIDs and option TEXT is the display name. Scope to
    // the container whose direct child span has exact text "State".
    const stateSelect = page
      .locator('div.flex.items-center.gap-2', {
        has: page.locator('span', { hasText: /^State$/ }),
      })
      .locator('select');
    await stateSelect.selectOption({ label: 'Research' });

    // Wait for Run Stage to appear after the state change persists.
    const runStageButton = page.getByRole('button', { name: /Run Stage/ });
    await expect(runStageButton).toBeVisible({ timeout: 15_000 });

    // Click — triggers pipeline.runs.trigger, setActiveRunId, RunDetailModal opens.
    await runStageButton.click();

    // RunDetailModal header renders once runId is set.
    await expect(page.getByText(/Pipeline Run/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Wait for the stage run to reach terminal "completed" status. The modal
    // renders the status via <PipelineStatusBadge> in the dialog header; the
    // badge is a rounded-full pill span whose text is "{Label}[ — {stage}]".
    // We extract the first word (the status label) and compare case-insensitively.
    //
    // Note: PipelineStatusBadge always renders the stage name as a sibling text
    // node inside the same pill span (e.g. "Completed — research"), so anchored
    // regex like /^completed$/ will never match the full textContent. We target
    // the pill span by its structural class and parse the first word instead.
    //
    // Live Claude completions for the Research stage typically land in under
    // 2 minutes; the test timeout is 5 minutes. Realtime subscription on
    // pipeline_run delivers the terminal update (no polling in the app).
    const statusBadge = page
      .locator('[aria-label="Run detail"]')
      .locator('span.rounded-full')
      .first();

    await expect.poll(
      async () => {
        const text = (await statusBadge.textContent()) ?? '';
        // Extract the first word: "Completed — research" → "completed"
        return text.trim().split(/[\s\u2014]/)[0].toLowerCase();
      },
      {
        timeout: 4 * 60_000,
        intervals: [2_000, 5_000, 10_000],
        message: 'stage_run never reached terminal completed status. Either live Claude failed to respond, or the Realtime subscription did not deliver the final update.',
      },
    ).toBe('completed');

    // Assert at least one tool_call entry streamed through the transcript.
    // LiveOutput renders ToolCallEntry components: a Terminal icon followed by a
    // <span class="text-slate-400"> containing the tool name in a child span and
    // the command text. There is NO ">" prefix in the DOM — that only appears in
    // the clipboard copy text. We assert the tool name span is visible by finding
    // any known Claude Code tool name rendered inside the dialog's output pane.
    const toolCallLine = page
      .locator('[aria-label="Run detail"]')
      .locator('.font-mono')
      .getByText(/\b(Bash|Read|Glob|Edit|Write|Grep|WebSearch|mcp__)\b/)
      .first();

    await expect(toolCallLine).toBeVisible({
      timeout: 10_000,
    });

    // Final gate: no pageerror, no Supabase registry / env / config errors.
    // Allow unrelated third-party noise (e.g. bundler/HMR warnings that pass
    // through console.error in dev) but fail hard on known regression patterns.
    const knownErrorPattern = /Adapter ".*" is not registered|Missing required environment variable|Missing Supabase config|Uncaught/;
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
