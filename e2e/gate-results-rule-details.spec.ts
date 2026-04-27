// e2e/gate-results-rule-details.spec.ts
// FLX-20 journey test: GateResultsPanel renders nested rule.field /
// rule.operator / rule.value text on each rule dot.
//
// The bug fixed in PR #110: the panel was reading top-level field /
// operator / expected, but the engine's RuleResult shape stores those
// under `rule.{field,operator,value}` (see src/core/gates/types.ts and
// src/core/gates/engine.ts). Symptom: dots rendered with empty text.
//
// Strategy: this is a pure render-shape regression. Spinning up live
// Claude just to produce a gate result is wasteful when the bug is in
// the renderer. Instead, the spec inserts a synthetic stage_run +
// stage_gate_result row matching the engine's actual ruleResult shape,
// then drives the UI to open RunDetailModal → Gates tab → asserts the
// rule text renders. If a future regression reads top-level fields
// again, the dots will be empty and this spec will fail.
//
// Env required: DATABASE_URL (or DIRECT_URL). Always runs.

import postgres from 'postgres';
import { expect, projectPath, test } from './helpers/setup';

const DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

test.describe('@flx-20 @journey', () => {
  test.skip(!DATABASE_URL, 'requires DATABASE_URL (or DIRECT_URL)');

  test('GateResultsPanel renders nested rule.field/operator/value text', async ({
    page,
  }) => {
    const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });

    // Look up seed scaffolding the synthetic run will hang off.
    const [issueRow] = await sql<
      {
        id: string;
        project_id: string;
        number: number;
        version: number;
      }[]
    >`SELECT id, project_id, number, version FROM "issue" WHERE "number" = 1 LIMIT 1`;
    expect(issueRow, 'seed must produce issue #1').toBeTruthy();

    const [implementStageRow] = await sql<
      { id: string; pipeline_id: string }[]
    >`SELECT id, pipeline_id FROM "pipeline_stage" WHERE name = 'implement' LIMIT 1`;
    expect(implementStageRow, 'seed must produce implement stage').toBeTruthy();

    // ── Insert synthetic pipeline_run + stage_run + stage_gate_result ─
    // Mirror the engine's RuleResult shape: each rule lives under
    // `rule: { field, operator, value, label }` with `passed`,
    // `actualValue`, `reason` at the top level.
    //
    // Two rules are inserted so the assertion fails distinctly if the
    // renderer regresses to reading top-level fields (both dots would
    // render with empty text instead of the expected formatted strings).
    const [runRow] = await sql<{ id: string }[]>`INSERT INTO "pipeline_run" (
        "pipeline_id", "issue_id", "status",
        "started_at", "completed_at"
      ) VALUES (
        ${implementStageRow.pipeline_id}, ${issueRow.id}, 'completed',
        NOW(), NOW()
      ) RETURNING id`;

    const [stageRunRow] = await sql<{ id: string }[]>`INSERT INTO "stage_run" (
        "pipeline_run_id", "pipeline_stage_id", "status",
        "started_at", "completed_at",
        "exit_code", "cost_usd"
      ) VALUES (
        ${runRow.id}, ${implementStageRow.id}, 'completed',
        NOW(), NOW(),
        0, '1.50'
      ) RETURNING id`;

    const ruleResults = [
      {
        rule: {
          field: 'exit_code',
          operator: 'equals',
          value: 0,
          label: 'Clean exit required',
          severity: 'required',
          onFail: 'rework',
        },
        passed: true,
        actualValue: 0,
        reason: null,
      },
      {
        rule: {
          field: 'cost_usd',
          operator: 'less_than',
          value: 10,
          label: 'Cost cap',
          severity: 'required',
          onFail: 'hold',
        },
        passed: true,
        actualValue: 1.5,
        reason: null,
      },
    ];

    await sql`INSERT INTO "stage_gate_result" (
        "stage_run_id", "verdict", "passed", "worst_action",
        "rule_snapshot", "rule_results", "reason"
      ) VALUES (
        ${stageRunRow.id}, 'proceed', true, NULL,
        ${sql.json({ logic: 'AND', rules: ruleResults.map((r) => r.rule) })},
        ${sql.json(ruleResults)},
        ''
      )`;

    // ── Drive the UI to render GateResultsPanel ─────────────────────
    // RunDetailModal opens via setActiveRunId which is local React
    // state — there's no URL surface to deep-link to a run. Instead,
    // navigate to the issue, click "View details" on the existing run
    // (the seeded pipeline-state query picks up our synthetic run as
    // the most recent pipeline_run for issue #1).
    await page.goto(projectPath('/issues/1'));
    await expect(
      page.getByRole('heading', { name: /Add health check endpoint/ })
    ).toBeVisible({ timeout: 15_000 });

    // The Pipeline Stages card shows a "View details" button when a
    // pipeline_run exists for the issue.
    const viewDetailsBtn = page.getByRole('button', { name: /View details/ });
    await expect(viewDetailsBtn).toBeVisible({ timeout: 15_000 });
    await viewDetailsBtn.click();

    // Modal opens. Click the implement stage row in the left sidebar
    // to select it (its name matches what we attached the gate to).
    const modal = page.locator('[aria-label="Run detail"]');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    const implementStageButton = modal
      .getByRole('button', { name: /implement/i })
      .first();
    await implementStageButton.click();

    // Switch to the Gates tab.
    const gatesTab = modal.getByRole('button', { name: /^Gates$/ });
    await gatesTab.click();

    // ── Assertions ──────────────────────────────────────────────────
    // Each rule renders as: `<field> <operator> <value>`. With the bug
    // present (reading top-level field/operator/expected) the spans
    // would be `  ` (three spaces). Match the formatted strings.
    await expect(
      modal.getByText('exit_code equals 0', { exact: true })
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      modal.getByText('cost_usd less_than 10', { exact: true })
    ).toBeVisible();

    // Labels render as " — <label>" siblings inside the same row.
    await expect(modal.getByText(/Clean exit required/)).toBeVisible();
    await expect(modal.getByText(/Cost cap/)).toBeVisible();

    // ── Cleanup ─────────────────────────────────────────────────────
    // Synthetic run is bound to the seeded issue/pipeline; nuke + seed
    // is the canonical reset, but be polite for repeat local runs by
    // dropping the synthetic chain so it doesn't compound.
    await sql`DELETE FROM "stage_gate_result" WHERE "stage_run_id" = ${stageRunRow.id}`;
    await sql`DELETE FROM "stage_run" WHERE "id" = ${stageRunRow.id}`;
    await sql`DELETE FROM "pipeline_run" WHERE "id" = ${runRow.id}`;
    await sql.end({ timeout: 5 });
  });
});
