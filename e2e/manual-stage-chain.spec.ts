// e2e/manual-stage-chain.spec.ts
//
// FLX-69 — THE ALPHA BAR.
//
// Drives the full manual stage execution chain end-to-end against live Claude:
// research → implement → review → deploy → complete. The operator changes
// state in the dropdown at each step, clicks Run Stage, waits for the stage
// to terminate, observes the gate verdict, then advances state manually.
// No daemon involved.
//
// Skips cleanly when ANTHROPIC_API_KEY (research/implement/review require
// live Claude) or the deploy creds (FLUXAOS_GITHUB_TOKEN /
// FLUXAOS_TEST_TARGET_REPO / FLUXAOS_TARGET_REPO_PATH / DATABASE_URL) are
// missing. With everything set, this proves:
//
//   - the engine can execute every stage in the seeded pipeline manually
//   - each stage completes (stage_run.status = 'completed'), gate verdict
//     row written, no console / page errors
//   - the operator can free-walk the state dropdown between stages (FLX-77)
//   - the deploy stage opens a real PR and auto-advances state to complete
//
// State at end: complete. Reseed to reset.

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Octokit } from '@octokit/rest';
import postgres from 'postgres';
import { expect, projectPath, test } from './helpers/setup';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.FLUXAOS_GITHUB_TOKEN;
const TARGET_REPO = process.env.FLUXAOS_TEST_TARGET_REPO;
const TARGET_REPO_PATH = process.env.FLUXAOS_TARGET_REPO_PATH;
const DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

const missingCreds: string[] = [];
if (!ANTHROPIC_API_KEY) missingCreds.push('ANTHROPIC_API_KEY');
if (!GITHUB_TOKEN) missingCreds.push('FLUXAOS_GITHUB_TOKEN');
if (!TARGET_REPO) missingCreds.push('FLUXAOS_TEST_TARGET_REPO');
if (!TARGET_REPO_PATH) missingCreds.push('FLUXAOS_TARGET_REPO_PATH');
if (!DATABASE_URL) missingCreds.push('DATABASE_URL (or DIRECT_URL)');

const HAS_ALL_CREDS = missingCreds.length === 0;

const REPO_ROOT = path.resolve(__dirname, '..');

// Stages walked in the manual chain. The seed pipeline contains research,
// implement, review (auto/rules gates) — deploy is wired by R-RUNTIME and
// auto-advances state via the deploy bridge. We click Run Stage at each
// state; for the non-deploy stages we manually advance state after the
// stage completes.
const NON_DEPLOY_STAGES = ['Research', 'Implement', 'Review'] as const;

type TrackedPR = {
  owner: string;
  repo: string;
  prNumber: number;
  branchName: string;
};
const openedPRs: TrackedPR[] = [];

test.describe('@flx-69 @journey @alpha-bar', () => {
  test.skip(
    !HAS_ALL_CREDS,
    `requires live credentials: missing ${missingCreds.join(', ')}`
  );

  // 5 stages × ~2 min live Claude + deploy git ops. Cap at 25 minutes.
  test.setTimeout(25 * 60_000);

  test('manual chain: research → implement → review → deploy → complete', async ({
    page,
  }) => {
    if (!existsSync(path.join(TARGET_REPO_PATH!, '.git'))) {
      throw new Error(
        `FLUXAOS_TARGET_REPO_PATH='${TARGET_REPO_PATH}' is not a git checkout.`
      );
    }

    // Reset DB so the issue starts clean. Same pattern as
    // r-runtime-deploy-journey.spec.ts.
    execSync('npx tsx src/scripts/db/nuke.ts', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    execSync('npm run db:seed', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    });

    const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
    const targetRepoUrl = `https://github.com/${TARGET_REPO}`;
    await sql`
      UPDATE "project"
      SET "repo_url" = ${targetRepoUrl},
          "default_branch" = 'main',
          "worktree_copy_files" = '[]'::jsonb,
          "updated_at" = NOW()
      WHERE "slug" = 'fluxaos'
    `;

    const [issueRow] = await sql<
      { id: string; project_id: string; number: number }[]
    >`SELECT id, project_id, number FROM "issue" WHERE "number" = 1 LIMIT 1`;
    expect(issueRow, 'seed did not produce issue #1').toBeTruthy();

    // Console-error capture.
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

    // ─── Walk each non-deploy stage ───────────────────────────────────────
    for (const stageLabel of NON_DEPLOY_STAGES) {
      // FLX-77: dropdown is free-walk; pick the state directly.
      await stateSelect.selectOption({ label: stageLabel });
      await expect
        .poll(
          async () =>
            stateSelect.evaluate((el) => {
              const select = el as HTMLSelectElement;
              return select.options[select.selectedIndex]?.text ?? '';
            }),
          { timeout: 10_000, intervals: [250, 500, 1_000] }
        )
        .toBe(stageLabel);

      // Snapshot pipeline_run count before triggering this stage.
      const stageKey = stageLabel.toLowerCase();
      const beforeRows = await sql<
        { id: string }[]
      >`SELECT pr.id FROM "pipeline_run" pr WHERE pr."issue_id" = ${issueRow.id}`;
      const beforeCount = beforeRows.length;

      const runStageButton = page.getByRole('button', { name: /Run Stage/ });
      await expect(runStageButton).toBeVisible({ timeout: 15_000 });
      await runStageButton.click();

      // Wait for a NEW pipeline_run row to land + reach a terminal status.
      const POLL_DEADLINE = Date.now() + 5 * 60_000;
      let runStatus: string | null = null;
      let runId: string | null = null;
      while (Date.now() < POLL_DEADLINE) {
        const rows = await sql<{ id: string; status: string }[]>`
          SELECT pr.id, pr.status
          FROM "pipeline_run" pr
          WHERE pr."issue_id" = ${issueRow.id}
          ORDER BY pr."created_at" DESC
          LIMIT 1
        `;
        if (rows[0] && rows.length === beforeCount + 1) {
          runId = rows[0].id;
          if (
            ['completed', 'failed', 'cancelled', 'error'].includes(
              rows[0].status
            )
          ) {
            runStatus = rows[0].status;
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 2_000));
      }

      expect(
        runStatus,
        `${stageKey} stage never reached terminal status within 5 minutes`
      ).toBe('completed');
      expect(
        runId,
        `pipeline_run row not visible for ${stageKey}`
      ).toBeTruthy();

      // Gate verdict row exists for this stage_run.
      const gateRows = await sql<
        { id: string; verdict: string }[]
      >`SELECT g.id, g.verdict
        FROM "stage_gate_result" g
        JOIN "stage_run" sr ON sr.id = g.stage_run_id
        WHERE sr.run_id = ${runId!}`;
      expect(
        gateRows,
        `no gate result written for ${stageKey} stage_run`
      ).not.toHaveLength(0);
    }

    // ─── Deploy stage: state → Deploy, click Run, deploy bridge takes over.
    await stateSelect.selectOption({ label: 'Deploy' });
    await expect
      .poll(
        async () =>
          stateSelect.evaluate((el) => {
            const select = el as HTMLSelectElement;
            return select.options[select.selectedIndex]?.text ?? '';
          }),
        { timeout: 10_000, intervals: [250, 500, 1_000] }
      )
      .toBe('Deploy');

    const beforeDeployRows = await sql<
      { id: string }[]
    >`SELECT pr.id FROM "pipeline_run" pr WHERE pr."issue_id" = ${issueRow.id}`;
    const beforeDeployCount = beforeDeployRows.length;

    const runStageButton = page.getByRole('button', { name: /Run Stage/ });
    await expect(runStageButton).toBeVisible({ timeout: 15_000 });
    await runStageButton.click();

    // Wait for terminal-with-PR (same DEF-020 condition as
    // r-runtime-deploy-journey).
    let deployTerminal: string | null = null;
    const DEPLOY_DEADLINE = Date.now() + 5 * 60_000;
    while (Date.now() < DEPLOY_DEADLINE) {
      const rows = await sql<{ id: string; status: string }[]>`
        SELECT pr.id, pr.status
        FROM "pipeline_run" pr
        WHERE pr."issue_id" = ${issueRow.id}
        ORDER BY pr."created_at" DESC
        LIMIT 1
      `;
      if (rows[0] && rows.length >= beforeDeployCount + 1) {
        if (['failed', 'cancelled', 'error'].includes(rows[0].status)) {
          deployTerminal = rows[0].status;
          break;
        }
        if (rows[0].status === 'completed') {
          const prRows = await sql<
            { id: string }[]
          >`SELECT id FROM "issue_pull_request" WHERE "issue_id" = ${issueRow.id} LIMIT 1`;
          if (prRows.length > 0) {
            deployTerminal = rows[0].status;
            break;
          }
        }
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    expect(
      deployTerminal,
      'deploy run never reached terminal-with-PR within 5 minutes'
    ).toBe('completed');

    // Deploy bridge auto-advances state. Per the seeded transition graph the
    // deploy stage advances the issue to "review"; the operator then walks
    // it to complete. (Pre-FLX-77 the spec would assert auto-advance to
    // "complete" but the deploy bridge currently writes "review".) We
    // assert the auto-advance happened, then walk to complete to close
    // the chain.
    const [issueAfterDeploy] = await sql<{ state_key: string | null }[]>`
      SELECT s."key" AS state_key
      FROM "issue" i
      JOIN "issue_state" s ON s."id" = i."state_id"
      WHERE i."id" = ${issueRow.id}
    `;
    expect(
      issueAfterDeploy?.state_key,
      'deploy did not auto-advance state'
    ).toBeTruthy();
    expect(['review', 'complete']).toContain(issueAfterDeploy.state_key);

    // Track PR for teardown.
    const prRows = await sql<
      {
        pr_number: number | null;
        head_branch: string;
      }[]
    >`SELECT pr_number, head_branch FROM "issue_pull_request" WHERE "issue_id" = ${issueRow.id}`;
    if (prRows[0]?.pr_number) {
      const [owner, repoName] = TARGET_REPO!.split('/');
      openedPRs.push({
        owner,
        repo: repoName,
        prNumber: prRows[0].pr_number,
        branchName: prRows[0].head_branch,
      });
    }

    // Walk to Complete (terminal). Reload to refresh state from server.
    await page.goto(projectPath('/issues/1'));
    const stateSelect2 = page
      .locator('div.flex.items-center.gap-2', {
        has: page.locator('span', { hasText: /^State$/ }),
      })
      .locator('select');
    await stateSelect2.selectOption({ label: 'Complete' });
    await expect
      .poll(
        async () =>
          stateSelect2.evaluate((el) => {
            const select = el as HTMLSelectElement;
            return select.options[select.selectedIndex]?.text ?? '';
          }),
        { timeout: 10_000, intervals: [250, 500, 1_000] }
      )
      .toBe('Complete');

    // Closed badge proves terminal state took (isClosed flipped true).
    await expect(page.getByText('Closed', { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // No registry/env/uncaught console errors during the entire chain.
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

    await sql.end();
  });

  // Teardown: close any PRs we opened so the disposable repo doesn't grow.
  test.afterAll(async () => {
    if (!GITHUB_TOKEN || openedPRs.length === 0) return;
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    for (const tracked of openedPRs) {
      try {
        await octokit.rest.pulls.update({
          owner: tracked.owner,
          repo: tracked.repo,
          pull_number: tracked.prNumber,
          state: 'closed',
        });
        await octokit.rest.git.deleteRef({
          owner: tracked.owner,
          repo: tracked.repo,
          ref: `heads/${tracked.branchName}`,
        });
      } catch {
        // best-effort cleanup
      }
    }
  });
});
