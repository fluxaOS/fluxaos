// e2e/r-runtime-deploy-journey.spec.ts
//
// R-RUNTIME T17 — end-to-end journey test for the deploy loop.
//
// This test drives the full R-RUNTIME happy path:
//   seed issue #1 → state=Implement → Run Stage → wait for terminal run →
//   assert issue advanced to Review, branch pushed, PR opened on GitHub,
//   isolation_environment marked inactive, worktree directory removed.
//
// The test requires live credentials for live Claude + a real GitHub repo;
// it skips cleanly when any are missing. In no case does it mock: this is
// the mechanical proof that R-RUNTIME actually works end-to-end.
//
// ── Operator setup (before running this test) ─────────────────────────────
//   1. Create a disposable GitHub repo (the test opens + closes PRs against
//      it; the branches it creates are cleaned up automatically).
//   2. Clone it to a local path on this machine, checkout `main`, leave it
//      clean. The orchestrator's worktree logic `git worktree add`s from
//      this checkout.
//   3. Export these env vars (e.g. into .env.local):
//        ANTHROPIC_API_KEY=sk-ant-...
//        FLUXAOS_GITHUB_TOKEN=ghp_...            # repo scope
//        FLUXAOS_TEST_TARGET_REPO=owner/repo     # the disposable repo
//        FLUXAOS_TARGET_REPO_PATH=/abs/path/to/local/checkout
//        PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003  # or local dev URL
//        DATABASE_URL=postgres://…               # same DB dev server uses
//      (`set -a; source .env.local; set +a` picks these up for Playwright.)
//   4. The dev server (`npm run dev -- -p 3003`) must be running. The test
//      nukes + reseeds the database before driving the UI.
//
// ── What this test asserts (after a completed run) ────────────────────────
//   - pipeline_run.status = 'completed'
//   - issue.state advanced to "review"
//   - issue_pull_request has 1 row for the issue with non-null pr_url + pr_number,
//     state = 'open'
//   - issue_branch has 1 row whose branch_name starts with `fluxaos/issue-1-`
//   - isolation_environment row for the run has status = 'inactive'
//   - worktree directory at <repo>/.fluxaos-worktrees/<branch> is GONE
//   - GitHub API confirms the branch is live on the remote and the PR is open
//   - No pageerror / registry / env console errors fired during the UI drive

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Octokit } from '@octokit/rest';
import postgres from 'postgres';
import { expect, projectPath, test } from './helpers/setup';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.FLUXAOS_GITHUB_TOKEN;
const TARGET_REPO = process.env.FLUXAOS_TEST_TARGET_REPO; // 'owner/repo'
const TARGET_REPO_PATH = process.env.FLUXAOS_TARGET_REPO_PATH; // local checkout
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

test.describe('@r-runtime @journey', () => {
  test.skip(
    !HAS_ALL_CREDS,
    `requires live credentials: missing ${missingCreds.join(', ')}`
  );

  // Real Claude + real GitHub round-trip. Cap at 5 min (poll logic caps at 3 min).
  test.setTimeout(5 * 60_000);

  test('deploy loop: issue → implement → PR opened → review state + cleanup', async ({
    page,
  }) => {
    // Guard: the repo path must be a real git checkout of the target repo.
    // We don't clone — operator responsibility per the header comment.
    if (!existsSync(path.join(TARGET_REPO_PATH!, '.git'))) {
      throw new Error(
        `FLUXAOS_TARGET_REPO_PATH='${TARGET_REPO_PATH}' is not a git checkout. ` +
          `Clone ${TARGET_REPO} to that path on main before running this test.`
      );
    }

    // ── Nuke + reseed the database ────────────────────────────────────────
    // Both scripts read DIRECT_URL / DATABASE_URL from the same env the test
    // uses, so they hit the same Postgres we'll query below.
    execSync('tsx src/scripts/db/nuke.ts', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    execSync('npm run db:seed', {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    });

    // ── Point the seed project at the disposable test repo ───────────────
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

    // Capture the seeded issue row (for id + project id) up-front.
    const [issueRow] = await sql<
      { id: string; project_id: string; number: number }[]
    >`SELECT id, project_id, number FROM "issue" WHERE "number" = 1 LIMIT 1`;
    expect(issueRow, 'seed did not produce issue #1').toBeTruthy();

    // Console-error capture (same pattern as real-anthropic-stage-run.spec.ts).
    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // ── Drive the UI: open issue #1, advance to Implement, trigger run ───
    await page.goto(projectPath('/issues/1'));
    await expect(
      page.getByRole('heading', { name: /Add health check endpoint/ })
    ).toBeVisible({ timeout: 15_000 });

    // Same CatalogSelect strategy as run-stage-smoke.spec.ts — anchor the
    // <select> via its sibling <span>State</span>.
    const stateSelect = page
      .locator('div.flex.items-center.gap-2', {
        has: page.locator('span', { hasText: /^State$/ }),
      })
      .locator('select');
    await stateSelect.selectOption({ label: 'Implement' });

    // Run Stage button appears once state matches a pipeline stage name.
    const runStageButton = page.getByRole('button', { name: /Run Stage/ });
    await expect(runStageButton).toBeVisible({ timeout: 15_000 });
    await runStageButton.click();

    // RunDetailModal header confirms the trigger fired.
    await expect(page.getByText(/Pipeline Run/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // ── Wait for the TRUE terminal condition (DEF-020 fix) ──────────────
    // `pipeline_run.status` flips to 'completed' BEFORE the deploy bridge's
    // awaited steps (commit+push+PR+transition). Waiting on status alone
    // races the PR/transition writes. Terminal condition is either:
    //   - status completed AND issue_pull_request row exists (deploy done), OR
    //   - status failed/cancelled/error (short-circuit, no PR expected).
    // Capped at 3 min per the T17 plan.
    let terminalStatus: string | null = null;
    let pipelineRunId: string | null = null;
    const POLL_DEADLINE = Date.now() + 3 * 60_000;
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
          // status terminal but deploy bridge still in flight — keep polling.
        }
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }

    expect(
      terminalStatus,
      'pipeline_run never reached terminal-with-PR state within 3 minutes'
    ).toBe('completed');
    expect(pipelineRunId).toBeTruthy();

    // ── Assertions: DB state after the deploy bridge fired ────────────────
    const [issueAfter] = await sql<{ state_key: string | null }[]>`
      SELECT s."key" AS state_key
      FROM "issue" i
      JOIN "issue_state" s ON s."id" = i."state_id"
      WHERE i."id" = ${issueRow.id}
    `;
    expect(issueAfter?.state_key, 'issue did not advance to review state').toBe(
      'review'
    );

    const prRows = await sql<
      {
        id: string;
        pr_url: string | null;
        pr_number: number | null;
        state: string;
        head_branch: string;
      }[]
    >`SELECT id, pr_url, pr_number, state, head_branch FROM "issue_pull_request" WHERE "issue_id" = ${issueRow.id}`;
    expect(prRows, 'expected exactly one PR row').toHaveLength(1);
    const prRow = prRows[0];
    expect(prRow.pr_url, 'pr_url must be populated').toBeTruthy();
    expect(prRow.pr_number, 'pr_number must be populated').toBeTruthy();
    expect(prRow.state).toBe('open');

    const branchRows = await sql<
      { branch_name: string }[]
    >`SELECT branch_name FROM "issue_branch" WHERE "issue_id" = ${issueRow.id}`;
    expect(branchRows, 'expected exactly one branch row').toHaveLength(1);
    const branchName = branchRows[0].branch_name;
    expect(branchName).toMatch(/^fluxaos\/issue-1-/);

    const isoRows = await sql<
      { status: string; working_path: string }[]
    >`SELECT status, working_path FROM "isolation_environment" WHERE "run_id" = ${pipelineRunId!}`;
    expect(
      isoRows,
      'expected exactly one isolation_environment row'
    ).toHaveLength(1);
    expect(isoRows[0].status, 'isolation_environment must be cleaned up').toBe(
      'inactive'
    );

    // Filesystem: the specific worktree dir must be gone after release.
    expect(
      existsSync(isoRows[0].working_path),
      `worktree directory not removed: ${isoRows[0].working_path}`
    ).toBe(false);

    // ── Assertions: GitHub confirms branch + PR exist on the remote ──────
    const [owner, repoName] = TARGET_REPO!.split('/');
    const octokit = new Octokit({ auth: GITHUB_TOKEN });

    const branchResp = await octokit.rest.repos.getBranch({
      owner,
      repo: repoName,
      branch: branchName,
    });
    expect(branchResp.status).toBe(200);
    expect(branchResp.data.name).toBe(branchName);

    const prResp = await octokit.rest.pulls.get({
      owner,
      repo: repoName,
      pull_number: prRow.pr_number!,
    });
    expect(prResp.status).toBe(200);
    expect(prResp.data.state).toBe('open');
    expect(prResp.data.head.ref).toBe(branchName);

    // Track for teardown so we close + delete even if later assertions fail.
    openedPRs.push({
      owner,
      repo: repoName,
      prNumber: prRow.pr_number!,
      branchName,
    });

    // ── Final gate: no unexpected console/page errors during the run ─────
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

    await sql.end({ timeout: 5 });
  });

  // ── Teardown: always close + delete remote branches we opened ─────────
  test.afterAll(async () => {
    if (!HAS_ALL_CREDS) return;
    const octokit = new Octokit({ auth: GITHUB_TOKEN });

    for (const pr of openedPRs) {
      // Close the PR (if still open). Catch-and-log: teardown must never throw.
      try {
        await octokit.rest.pulls.update({
          owner: pr.owner,
          repo: pr.repo,
          pull_number: pr.prNumber,
          state: 'closed',
        });
      } catch (err) {
        console.warn(
          `[teardown] failed to close PR #${pr.prNumber} on ${pr.owner}/${pr.repo}: ${(err as Error).message}`
        );
      }

      // Delete the remote branch.
      try {
        await octokit.rest.git.deleteRef({
          owner: pr.owner,
          repo: pr.repo,
          ref: `heads/${pr.branchName}`,
        });
      } catch (err) {
        console.warn(
          `[teardown] failed to delete ref heads/${pr.branchName} on ${pr.owner}/${pr.repo}: ${(err as Error).message}`
        );
      }
    }
  });
});
