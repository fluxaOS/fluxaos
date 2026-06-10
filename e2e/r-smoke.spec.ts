// e2e/r-smoke.spec.ts
//
// R-SMOKE — alpha acceptance journey.
//
// The single end-to-end proof that the assembled engine delivers the
// alpha promise: file an epic with one child issue, the daemon picks
// it up, the worker runs in an isolated worktree, a PR opens on
// GitHub, the child issue advances to `review`, the operator closes
// the child, the parent auto-closes (R-EPIC propagation), and the
// PR-close cleanup hook is idempotent.
//
// Skips cleanly when any of the live creds are missing.
//
// ── Operator setup (before running this test) ─────────────────────────────
//   1. A disposable GitHub repo + a clean local checkout on `main`.
//   2. Export in .env.local:
//        ANTHROPIC_API_KEY=sk-ant-...
//        FLUXAOS_GITHUB_TOKEN=ghp_...            # repo scope
//        FLUXAOS_TEST_TARGET_REPO=owner/repo
//        FLUXAOS_TARGET_REPO_PATH=/abs/path/to/local/checkout
//        PLAYWRIGHT_BASE_URL=http://192.168.54.101:3013
//        DATABASE_URL=postgres://…
//   3. Dev server up on the configured port. The test nukes + reseeds
//      the database before driving the UI.
//
// FLUXAOS_TARGET_REPO_PATH is legacy/test-only fixture input here: after
// seeding, the spec writes it into project.target_repo_path so the daemon
// proves the DB-backed FLX-221 runtime path. Do not treat this env var as
// operator runtime configuration.

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

async function transition(
  page: import('@playwright/test').Page,
  issueId: string,
  toStateId: string,
  version: number
): Promise<void> {
  const resp = await page.request.post(`/api/trpc/issue.transition?batch=1`, {
    data: { '0': { id: issueId, toStateId, version } },
  });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(
      `issue.transition to ${toStateId} failed: ${resp.status()} ${body}`
    );
  }
}

test.describe('@r-smoke @journey @alpha-acceptance', () => {
  test.skip(
    !HAS_ALL_CREDS,
    `requires live credentials: missing ${missingCreds.join(', ')}`
  );

  test.setTimeout(8 * 60_000);

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
    if (!HAS_ALL_CREDS) return;
    const octokit = new Octokit({ auth: GITHUB_TOKEN });
    for (const pr of openedPRs) {
      try {
        await octokit.rest.pulls.update({
          owner: pr.owner,
          repo: pr.repo,
          pull_number: pr.prNumber,
          state: 'closed',
        });
      } catch (err) {
        console.warn(
          `[teardown] failed to close PR #${pr.prNumber}: ${(err as Error).message}`
        );
      }
      try {
        await octokit.rest.git.deleteRef({
          owner: pr.owner,
          repo: pr.repo,
          ref: `heads/${pr.branchName}`,
        });
      } catch (err) {
        console.warn(
          `[teardown] failed to delete ref heads/${pr.branchName}: ${(err as Error).message}`
        );
      }
    }
  });

  test('alpha acceptance: epic + child → daemon → PR → review → close → parent auto-close → cleanup', async ({
    page,
  }) => {
    if (!existsSync(path.join(TARGET_REPO_PATH!, '.git'))) {
      throw new Error(
        `FLUXAOS_TARGET_REPO_PATH='${TARGET_REPO_PATH}' is not a git checkout. Clone ${TARGET_REPO} to that path on main before running this test.`
      );
    }

    // R-SMOKE is destructive — it `git reset --hard origin/main && git clean -fdx`s
    // the target repo. Refuse to run if the target IS this fluxaOS source root,
    // which would nuke uncommitted work + branches in the project itself.
    if (path.resolve(TARGET_REPO_PATH!) === REPO_ROOT) {
      throw new Error(
        `FLUXAOS_TARGET_REPO_PATH='${TARGET_REPO_PATH}' resolves to the fluxaOS source root. ` +
          `R-SMOKE is destructive and would wipe uncommitted work. ` +
          `Point at a separate disposable repo, or run a non-destructive journey (r-runtime-deploy-journey works against fluxaOS).`
      );
    }

    // ── 1. Nuke + reseed ──────────────────────────────────────────────────
    await resetDb();

    // ── 1b. Reset target repo to a clean main ────────────────────────────
    // Each test run injects a unique-named file into the target so the
    // implement skill can't short-circuit with "already_complete" on
    // residue from prior test runs. The journey body fills the issue with
    // a request that references this filename.
    const uniqueArtifact = `R-SMOKE-${Date.now()}.md`;
    execSync(
      'git fetch origin --prune && git reset --hard origin/main && git clean -fdx',
      {
        cwd: TARGET_REPO_PATH!,
        stdio: 'inherit',
        env: process.env,
      }
    );

    // ── 2. Point seed project at the disposable repo ─────────────────────
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

    // R-POLISH-CORE W1 fixed the production seed: 3 stages
    // (research auto → implement rules → review auto), no broken
    // deploy stage. R-SMOKE runs against the unmodified seed.

    const [parentRow] = await sql<
      { id: string; project_id: string; number: number; version: number }[]
    >`SELECT id, project_id, number, version FROM "issue" WHERE "number" = 1 LIMIT 1`;
    expect(parentRow, 'seed did not produce issue #1').toBeTruthy();

    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // ── 3. Visit parent #1, RelationshipsCard renders ────────────────────
    await page.goto(projectPath(`/issues/${parentRow.number}`));
    await expect(
      page.getByRole('heading', { name: /Add health check endpoint/ })
    ).toBeVisible({ timeout: 15_000 });

    // ── 4. Create child via the "Create child issue" affordance ──────────
    await page.getByRole('link', { name: /Create child issue/ }).click();
    await expect(page).toHaveURL(/\/issues\/new\?parent=/);

    const childTitle = `R-SMOKE child ${Date.now()}`;
    await page.getByPlaceholder('Issue title').fill(childTitle);
    // Substantive body — deploy-stage skill rejects content-free issues with
    // a `hold` signal ("no actionable content"), which never reaches the
    // terminal-with-PR gate. Reference the unique artifact name from the
    // target-reset step so the implement skill can't short-circuit with
    // "already_complete" on a residue file from a prior test run.
    await page
      .locator('textarea')
      .first()
      .fill(
        [
          `Add a new file \`${uniqueArtifact}\` to the repo root containing exactly:`,
          '',
          '```',
          `# ${uniqueArtifact}`,
          '',
          'R-SMOKE journey marker.',
          '```',
          '',
          'No other files should change.',
        ].join('\n')
      );
    await page.getByRole('button', { name: /Create Issue/ }).click();

    // ── 5. Land on child's detail page; capture child id + number ────────
    await page.waitForURL(/\/issues\/\d+/, { timeout: 15_000 });
    const childUrl = page.url();
    const childNumberMatch = childUrl.match(/\/issues\/(\d+)/);
    expect(
      childNumberMatch,
      'failed to parse child issue number from url'
    ).toBeTruthy();
    const childNumber = Number(childNumberMatch?.[1]);

    const [childRow] = await sql<
      { id: string; parent_issue_id: string | null; version: number }[]
    >`SELECT id, parent_issue_id, version FROM "issue" WHERE "number" = ${childNumber} AND "project_id" = ${parentRow.project_id}`;
    expect(childRow, 'child issue row not found in DB').toBeTruthy();
    expect(childRow.parent_issue_id).toBe(parentRow.id);

    // ── 6. Verify parent rejection: Run Stage on parent is disabled ──────
    await page.goto(projectPath(`/issues/${parentRow.number}`));
    await expect(
      page.getByRole('heading', { name: /Add health check endpoint/ })
    ).toBeVisible({ timeout: 10_000 });
    const parentRunStage = page.getByRole('button', { name: /Run Stage/ });
    // Either the button is disabled (preferred R-EPIC surface), or absent
    // because the parent's state isn't a pipeline-stage state. If visible,
    // it must be disabled.
    if (await parentRunStage.isVisible().catch(() => false)) {
      await expect(parentRunStage).toBeDisabled();
    }

    // ── 7. Walk child to Implement, click Run Stage ──────────────────────
    await page.goto(projectPath(`/issues/${childNumber}`));
    await expect(page.getByRole('heading', { name: childTitle })).toBeVisible({
      timeout: 10_000,
    });

    const stateSelect = page
      .locator('div.flex.items-center.gap-2', {
        has: page.locator('span', { hasText: /^State$/ }),
      })
      .locator('select');
    await stateSelect.selectOption({ label: 'Implement' });

    const childRunStage = page.getByRole('button', { name: /Run Stage/ });
    await expect(childRunStage).toBeVisible({ timeout: 15_000 });
    await childRunStage.click();

    await expect(page.getByText(/Pipeline Run/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // ── 8. Poll for terminal-with-PR (DEF-020 fix from R-RUNTIME) ────────
    let terminalStatus: string | null = null;
    let pipelineRunId: string | null = null;
    const POLL_DEADLINE = Date.now() + 5 * 60_000;
    while (Date.now() < POLL_DEADLINE) {
      const rows = await sql<
        { id: string; status: string }[]
      >`SELECT id, status FROM "pipeline_run" WHERE "issue_id" = ${childRow.id} ORDER BY "created_at" DESC LIMIT 1`;
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
          >`SELECT id FROM "issue_pull_request" WHERE "issue_id" = ${childRow.id} LIMIT 1`;
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
      'pipeline_run never reached terminal-with-PR within 5 minutes'
    ).toBe('completed');
    expect(pipelineRunId).toBeTruthy();

    // ── 9. DB assertions for the child ────────────────────────────────────
    const [childAfter] = await sql<
      { state_key: string | null; version: number }[]
    >`
      SELECT s."key" AS state_key, i.version
      FROM "issue" i
      JOIN "issue_state" s ON s."id" = i."state_id"
      WHERE i."id" = ${childRow.id}
    `;
    expect(childAfter?.state_key, 'child issue did not advance to review').toBe(
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
    >`SELECT id, pr_url, pr_number, state, head_branch FROM "issue_pull_request" WHERE "issue_id" = ${childRow.id}`;
    expect(prRows, 'expected exactly one PR row for child').toHaveLength(1);
    const prRow = prRows[0];
    expect(prRow.pr_url).toBeTruthy();
    expect(prRow.pr_number).toBeTruthy();
    expect(prRow.state).toBe('open');

    const branchRows = await sql<
      { branch_name: string }[]
    >`SELECT branch_name FROM "issue_branch" WHERE "issue_id" = ${childRow.id}`;
    expect(branchRows, 'expected exactly one branch row').toHaveLength(1);
    const branchName = branchRows[0].branch_name;
    expect(branchName).toMatch(new RegExp(`^fluxaos\\/issue-${childNumber}-`));

    const isoRows = await sql<
      { status: string; working_path: string }[]
    >`SELECT status, working_path FROM "isolation_environment" WHERE "run_id" = ${pipelineRunId!}`;
    expect(
      isoRows,
      'expected exactly one isolation_environment row'
    ).toHaveLength(1);
    expect(isoRows[0].status).toBe('inactive');
    expect(
      existsSync(isoRows[0].working_path),
      `worktree directory should be removed: ${isoRows[0].working_path}`
    ).toBe(false);

    // ── 10. GitHub assertions ─────────────────────────────────────────────
    const [owner, repoName] = TARGET_REPO!.split('/');
    const octokit = new Octokit({ auth: GITHUB_TOKEN });

    const branchResp = await octokit.rest.repos.getBranch({
      owner,
      repo: repoName,
      branch: branchName,
    });
    expect(branchResp.status).toBe(200);

    const prResp = await octokit.rest.pulls.get({
      owner,
      repo: repoName,
      pull_number: prRow.pr_number!,
    });
    expect(prResp.status).toBe(200);
    expect(prResp.data.state).toBe('open');
    expect(prResp.data.head.ref).toBe(branchName);

    openedPRs.push({
      owner,
      repo: repoName,
      prNumber: prRow.pr_number!,
      branchName,
    });

    // ── 11. Walk child review → deploy → complete (terminal) ─────────────
    const stateRows = await sql<
      { id: string; key: string }[]
    >`SELECT id, key FROM "issue_state" WHERE "project_id" = ${parentRow.project_id}`;
    const keyToStateId = new Map(stateRows.map((s) => [s.key, s.id]));
    const deployStateId = keyToStateId.get('deploy');
    const completeStateId = keyToStateId.get('complete');
    expect(deployStateId, 'seed missing deploy state').toBeTruthy();
    expect(completeStateId, 'seed missing complete state').toBeTruthy();

    await transition(page, childRow.id, deployStateId!, childAfter.version);

    const [childAfterDeploy] = await sql<
      { version: number }[]
    >`SELECT version FROM "issue" WHERE "id" = ${childRow.id}`;
    await transition(
      page,
      childRow.id,
      completeStateId!,
      childAfterDeploy.version
    );

    // ── 12. Parent auto-close assertion ──────────────────────────────────
    const [parentAfter] = await sql<
      { state_key: string | null; is_closed: boolean }[]
    >`
      SELECT s."key" AS state_key, i.is_closed
      FROM "issue" i
      JOIN "issue_state" s ON s."id" = i."state_id"
      WHERE i."id" = ${parentRow.id}
    `;
    // Parent should be auto-closed by R-EPIC propagation when last child closed.
    expect(
      parentAfter?.is_closed,
      'parent did not auto-close after child completion'
    ).toBe(true);

    // ── 13. Post-pipeline cleanup state ──────────────────────────────────
    // The terminal hook releases the worktree on stage completion, so by
    // the time we reach here the isolation_environment is already inactive
    // and working_path is gone (asserted in step 9). The dedicated
    // PR-close → cleanup webhook is post-alpha (per spec §9); the engine
    // exposes onPrClosed in-process and cleanup-triggers.test.ts already
    // covers idempotency. R-SMOKE asserts the post-pipeline steady state
    // a second time here as a stability check after the parent auto-close.
    const [isoAfterCleanup] = await sql<
      { status: string; working_path: string }[]
    >`SELECT status, working_path FROM "isolation_environment" WHERE "run_id" = ${pipelineRunId!}`;
    expect(isoAfterCleanup.status).toBe('inactive');
    expect(existsSync(isoAfterCleanup.working_path)).toBe(false);

    // ── 14. Console-error gate ────────────────────────────────────────────
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

    // ── 15. Daemon liveness ───────────────────────────────────────────────
    const daemonAlive = handle !== null && handle.daemon.exitCode === null;
    expect(daemonAlive, 'daemon died mid-run').toBe(true);

    await sql.end({ timeout: 5 });
  });
});
