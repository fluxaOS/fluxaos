// e2e/manual-stage-chain.spec.ts
//
// FLX-69 — THE ALPHA BAR.
//
// Drives the full pipeline end-to-end against live Claude:
// research → implement → review → deploy. Operator clicks Run Stage ONCE
// at state=Research; the daemon walks every stage in the seeded pipeline
// back-to-back (this is the engine's only execution path — see FLX-80).
// The deploy bridge auto-advances state to Review and opens a PR; the
// operator then walks state to Complete.
//
// Skips cleanly when ANTHROPIC_API_KEY (live Claude required) or any
// deploy cred (FLUXAOS_GITHUB_TOKEN / FLUXAOS_TEST_TARGET_REPO /
// FLUXAOS_TARGET_REPO_PATH / DATABASE_URL) is missing. The
// FLUXAOS_TARGET_REPO_PATH env var is legacy/test-only fixture input here:
// after seeding, the spec writes it into project.target_repo_path so the
// daemon proves the DB-backed FLX-221 runtime path. Do not treat this env
// var as operator runtime configuration. With everything set, this proves:
//
//   - Engine boot + Realtime pickup + daemon execution loop work
//     end-to-end against live Claude.
//   - Every seeded stage (research / implement / review) lands a
//     completed stage_run row with a stage_gate_result verdict written.
//   - The deploy bridge opens a real PR on GitHub and isolation
//     cleanup happens (worktree gone, isolation_environment inactive).
//   - The operator can free-walk state (FLX-77) to Complete and the
//     Closed indicator renders.
//
// Distinct from r-smoke (R-EPIC parent/child propagation, child-issue
// path) and r-runtime-deploy-journey (starts at Implement, asserts the
// runtime cleanup contract): this spec asserts the FULL chain for the
// parent-issue path with explicit per-stage_run gate-verdict checks.

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Octokit } from '@octokit/rest';
import postgres from 'postgres';
import { type DaemonHandle, spawnDaemon } from './helpers/daemon';
import { resetDb } from './helpers/reset-db';
import { expect, projectPath, test } from './helpers/setup';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.FLUXAOS_GITHUB_TOKEN;
const TARGET_REPO = process.env.FLUXAOS_TEST_TARGET_REPO;
// Legacy/test-only checkout path; persisted into project.target_repo_path
// below so runtime still exercises the DB-backed FLX-221 path.
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

type TrackedPR = {
  owner: string;
  repo: string;
  prNumber: number;
  branchName: string;
};
const openedPRs: TrackedPR[] = [];
let handle: DaemonHandle | null = null;

test.describe('@flx-69 @journey @alpha-bar', () => {
  test.skip(
    !HAS_ALL_CREDS,
    `requires live credentials: missing ${missingCreds.join(', ')}`
  );

  // Live Claude × 3 stages + deploy git ops + Complete walk. Cap at 15 min.
  test.setTimeout(15 * 60_000);

  test.beforeAll(async () => {
    handle = await spawnDaemon();
  });

  test.afterAll(async () => {
    if (handle) {
      try {
        await handle.shutdown();
      } catch (err) {
        console.warn(
          `[teardown] daemon shutdown failed: ${(err as Error).message}`
        );
      }
    }
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
      } catch {
        // best-effort
      }
      try {
        await octokit.rest.git.deleteRef({
          owner: tracked.owner,
          repo: tracked.repo,
          ref: `heads/${tracked.branchName}`,
        });
      } catch {
        // best-effort
      }
    }
  });

  test('full chain: research → implement → review → deploy → complete', async ({
    page,
  }) => {
    if (!existsSync(path.join(TARGET_REPO_PATH!, '.git'))) {
      throw new Error(
        `FLUXAOS_TARGET_REPO_PATH='${TARGET_REPO_PATH}' is not a git checkout.`
      );
    }

    // manual-stage-chain is destructive — `git reset --hard origin/main && git clean -fdx`s
    // the target. Refuse to run when the target IS this fluxaOS source root,
    // which would wipe uncommitted work + branches in the project itself.
    if (path.resolve(TARGET_REPO_PATH!) === REPO_ROOT) {
      throw new Error(
        `FLUXAOS_TARGET_REPO_PATH='${TARGET_REPO_PATH}' resolves to the fluxaOS source root. ` +
          `manual-stage-chain is destructive and would wipe uncommitted work. ` +
          `Point at a separate disposable repo, or run a non-destructive journey.`
      );
    }

    // Reset DB and target repo so the run starts clean.
    await resetDb();
    execSync(
      'git fetch origin --prune && git reset --hard origin/main && git clean -fdx',
      {
        cwd: TARGET_REPO_PATH!,
        stdio: 'inherit',
        env: process.env,
      }
    );

    const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
    const targetRepoUrl = `https://github.com/${TARGET_REPO}`;
    // FLX-221: target_repo_path is a per-project column; persist the
    // operator-supplied value to the row so the daemon picks it up.
    await sql`
      UPDATE "project"
      SET "repo_url" = ${targetRepoUrl},
          "default_branch" = 'main',
          "worktree_copy_files" = '[]'::jsonb,
          "target_repo_path" = ${TARGET_REPO_PATH!},
          "updated_at" = NOW()
      WHERE "slug" = 'fluxaos'
    `;

    const [issueRow] = await sql<
      { id: string; project_id: string; number: number }[]
    >`SELECT id, project_id, number FROM "issue" WHERE "number" = 1 LIMIT 1`;
    expect(issueRow, 'seed did not produce issue #1').toBeTruthy();

    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // ── Open issue, set state to Research, click Run Stage once ──────────
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

    // ── Poll for terminal-with-PR (DEF-020): pipeline_run.status flips to
    // `completed` before the deploy bridge's commit/push/PR sequence. Wait
    // for both. Cap at 10 min for 3 live Claude stages + deploy git ops.
    let terminalStatus: string | null = null;
    let pipelineRunId: string | null = null;
    const POLL_DEADLINE = Date.now() + 10 * 60_000;
    while (Date.now() < POLL_DEADLINE) {
      const rows = await sql<
        { id: string; status: string }[]
      >`SELECT id, status FROM "pipeline_run" WHERE "issue_id" = ${issueRow.id} ORDER BY "created_at" DESC LIMIT 1`;
      if (rows[0]) {
        pipelineRunId = rows[0].id;
        const status = rows[0].status;
        if (['failed', 'cancelled', 'error'].includes(status)) {
          terminalStatus = status;
          break;
        }
        if (status === 'completed') {
          const prRows = await sql<
            { id: string }[]
          >`SELECT id FROM "issue_pull_request" WHERE "issue_id" = ${issueRow.id} LIMIT 1`;
          if (prRows.length > 0) {
            terminalStatus = status;
            break;
          }
        }
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    expect(
      terminalStatus,
      'pipeline_run never reached terminal-with-PR within 10 minutes'
    ).toBe('completed');
    expect(pipelineRunId).toBeTruthy();

    // ── Per-stage assertions: every seeded stage_run completed and a gate
    // verdict row exists. The full-chain proof = N completed stage_runs +
    // N gate rows + a PR. Stage names come from pipeline_stage so the
    // engine stays agnostic.
    const stageRows = await sql<
      {
        id: string;
        status: string;
        stage_name: string;
        skill_signal: string | null;
      }[]
    >`SELECT sr.id, sr.status, ps.name AS stage_name, sr.skill_signal
        FROM "stage_run" sr
        JOIN "pipeline_stage" ps ON ps.id = sr.pipeline_stage_id
        WHERE sr.pipeline_run_id = ${pipelineRunId!}
        ORDER BY ps.sort_order`;
    expect(
      stageRows.length,
      'expected at least one stage_run per seeded stage'
    ).toBeGreaterThanOrEqual(3);
    for (const sr of stageRows) {
      expect(sr.status, `stage_run for ${sr.stage_name} did not complete`).toBe(
        'completed'
      );
      const gateRows = await sql<
        { verdict: string }[]
      >`SELECT verdict FROM "stage_gate_result" WHERE stage_run_id = ${sr.id}`;
      expect(
        gateRows,
        `no gate result row for ${sr.stage_name} stage_run`
      ).not.toHaveLength(0);
      expect(
        ['proceed', 'rework', 'hold', 'abort'],
        `unexpected gate verdict for ${sr.stage_name}: ${gateRows[0].verdict}`
      ).toContain(gateRows[0].verdict);
    }

    // ── Deploy assertions: PR opened, branch on remote, isolation cleaned.
    const prRows = await sql<
      {
        pr_url: string | null;
        pr_number: number | null;
        state: string;
        head_branch: string;
      }[]
    >`SELECT pr_url, pr_number, state, head_branch FROM "issue_pull_request" WHERE "issue_id" = ${issueRow.id}`;
    expect(prRows, 'expected one PR row for issue #1').toHaveLength(1);
    const prRow = prRows[0];
    expect(prRow.pr_url).toBeTruthy();
    expect(prRow.pr_number).toBeTruthy();
    expect(prRow.state).toBe('open');

    const isoRows = await sql<
      { status: string; working_path: string }[]
    >`SELECT status, working_path FROM "isolation_environment" WHERE "run_id" = ${pipelineRunId!}`;
    expect(isoRows).toHaveLength(1);
    expect(isoRows[0].status).toBe('inactive');
    expect(
      existsSync(isoRows[0].working_path),
      `worktree directory should be removed: ${isoRows[0].working_path}`
    ).toBe(false);

    const [owner, repoName] = TARGET_REPO!.split('/');
    const octokit = new Octokit({ auth: GITHUB_TOKEN! });
    const prResp = await octokit.rest.pulls.get({
      owner,
      repo: repoName,
      pull_number: prRow.pr_number!,
    });
    expect(prResp.status).toBe(200);
    expect(prResp.data.state).toBe('open');

    openedPRs.push({
      owner,
      repo: repoName,
      prNumber: prRow.pr_number!,
      branchName: prRow.head_branch,
    });

    // ── Walk state to Complete (FLX-77 free-walk dropdown). Reload to get
    // a fresh version after deploy bridge auto-advance, then transition.
    await page.goto(projectPath('/issues/1'));
    await expect(
      page.getByRole('heading', { name: /Add health check endpoint/ })
    ).toBeVisible({ timeout: 15_000 });

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
});
