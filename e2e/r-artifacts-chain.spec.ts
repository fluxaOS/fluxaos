// R-ARTIFACTS chain journey: research → implement end-to-end.
// Stage 1 writes research-findings.md; stage 2 reads it, writes plan.md,
// edits the worktree; deploy bridge opens a PR on the sandbox.
// Env required: ANTHROPIC_API_KEY, FLUXAOS_GITHUB_TOKEN,
// FLUXAOS_TEST_TARGET_REPO, FLUXAOS_TARGET_REPO_PATH, DATABASE_URL.
// Skips cleanly when any are missing.

import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Octokit } from '@octokit/rest';
import postgres from 'postgres';
import { expect, projectPath, test } from './helpers/setup';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.FLUXAOS_GITHUB_TOKEN;
const TARGET_REPO = process.env.FLUXAOS_TEST_TARGET_REPO; // 'owner/repo'
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
const artifactDirsToRemove: string[] = [];

test.describe('@r-artifacts @journey', () => {
  test.skip(
    !HAS_ALL_CREDS,
    `requires live credentials: missing ${missingCreds.join(', ')}`
  );

  // Two live Claude calls + deploy round-trip. Longer than the R-RUNTIME
  // journey (3 min poll cap there; two stages here → 5 min poll cap).
  test.setTimeout(8 * 60_000);

  test('research → implement chain: artifact written, consumed, PR opened', async ({
    page,
  }) => {
    // Guard: target repo must be a git checkout on disk.
    if (!existsSync(path.join(TARGET_REPO_PATH!, '.git'))) {
      throw new Error(
        `FLUXAOS_TARGET_REPO_PATH='${TARGET_REPO_PATH}' is not a git checkout. ` +
          `Clone ${TARGET_REPO} to that path on main before running this test.`
      );
    }

    // ── Nuke + reseed the database ──────────────────────────────────
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

    // ── Point the seed project at the disposable test repo ─────────
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

    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // ── Open issue #1 ───────────────────────────────────────────────
    await page.goto(projectPath('/issues/1'));
    await expect(
      page.getByRole('heading', { name: /Add health check endpoint/ })
    ).toBeVisible({ timeout: 15_000 });

    const stateSelect = page
      .locator('div.flex.items-center.gap-2', {
        has: page.locator('span', { hasText: /^State$/ }),
      })
      .locator('select');

    // ── Stage 1: Research ──────────────────────────────────────────
    await stateSelect.selectOption({ label: 'Research' });

    const runStage1 = page.getByRole('button', { name: /Run Stage/ });
    await expect(runStage1).toBeVisible({ timeout: 15_000 });
    await runStage1.click();

    await expect(page.getByText(/Pipeline Run/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Wait for research run to terminate in DB. No PR is expected
    // because the research stage writes only to the artifacts dir —
    // deploy bridge sees a clean worktree and short-circuits.
    let researchRunId: string | null = null;
    {
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        const rows = await sql<
          { id: string; status: string }[]
        >`SELECT id, status FROM "pipeline_run"
            WHERE "issue_id" = ${issueRow.id}
            ORDER BY "created_at" DESC LIMIT 1`;
        if (rows[0]) {
          researchRunId = rows[0].id;
          if (
            ['completed', 'failed', 'cancelled', 'error'].includes(
              rows[0].status
            )
          ) {
            expect(
              rows[0].status,
              'research stage must complete for the chain'
            ).toBe('completed');
            break;
          }
        }
        await new Promise((r) => setTimeout(r, 2_000));
      }
      expect(
        researchRunId,
        'research pipeline_run never reached terminal status'
      ).toBeTruthy();
    }

    // Dismiss the stage-1 modal (DEF-021 — Escape wired on RunDetailModal).
    await page.keyboard.press('Escape');
    await page.waitForSelector('div[role="dialog"][aria-label="Run detail"]', {
      state: 'detached',
      timeout: 5_000,
    });

    // Stage 2 via tRPC, not UI: the UI's Run Stage button reads matchingStage
    // from a closed-over render whose state may be stale vs the just-fired
    // transition mutation, leading to the click re-running research.
    const [implementStageRow] = await sql<
      { id: string; pipeline_id: string }[]
    >`SELECT ps.id, ps.pipeline_id
        FROM "pipeline_stage" ps
        WHERE ps.name = 'implement' LIMIT 1`;
    expect(
      implementStageRow,
      'implement pipeline_stage not found in seed data'
    ).toBeTruthy();

    const [implementStateRow] = await sql<
      { id: string }[]
    >`SELECT id FROM "issue_state" WHERE "key" = 'implement' LIMIT 1`;
    expect(
      implementStateRow,
      'implement issue_state not found in seed data'
    ).toBeTruthy();

    // Advance state research → implement first, else deploy bridge rejects
    // post-implement transition (research → review is INVALID).
    const [issueVersionRow] = await sql<
      { version: number }[]
    >`SELECT version FROM "issue" WHERE "id" = ${issueRow.id}`;

    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3003';
    const transitionResp = await page.request.post(
      `${baseUrl}/api/trpc/issue.transition?batch=1`,
      {
        data: {
          '0': {
            id: issueRow.id,
            toStateId: implementStateRow.id,
            version: issueVersionRow.version,
          },
        },
      }
    );
    expect(
      transitionResp.ok(),
      `state transition failed: ${transitionResp.status()} ${await transitionResp.text()}`
    ).toBe(true);

    const trpcResp = await page.request.post(
      `${baseUrl}/api/trpc/pipeline.runs.trigger?batch=1`,
      {
        data: {
          '0': {
            pipelineId: implementStageRow.pipeline_id,
            issueId: issueRow.id,
            stageId: implementStageRow.id,
          },
        },
      }
    );
    expect(
      trpcResp.ok(),
      `tRPC trigger failed: ${trpcResp.status()} ${await trpcResp.text()}`
    ).toBe(true);

    // ── DEF-020 fix: poll until (a) pipeline_run is terminal AND an
    // issue_pull_request row exists for the issue, OR (b) pipeline_run
    // short-circuits into failed/cancelled/error (no PR expected).
    // Implements the new terminal-condition contract for this journey.
    let implementRunId: string | null = null;
    let terminalStatus: string | null = null;
    let prRowExists = false;
    {
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        const rows = await sql<
          { id: string; status: string }[]
        >`SELECT id, status FROM "pipeline_run"
            WHERE "issue_id" = ${issueRow.id} AND "id" <> ${researchRunId!}
            ORDER BY "created_at" DESC LIMIT 1`;
        if (rows[0]) {
          implementRunId = rows[0].id;
          terminalStatus = rows[0].status;

          // Short-circuit: no PR expected on non-happy terminal.
          if (['failed', 'cancelled', 'error'].includes(rows[0].status)) {
            break;
          }

          // Happy path: wait for issue_pull_request row too.
          if (rows[0].status === 'completed') {
            const [prRow] = await sql<
              { id: string }[]
            >`SELECT id FROM "issue_pull_request"
                WHERE "issue_id" = ${issueRow.id} LIMIT 1`;
            if (prRow) {
              prRowExists = true;
              break;
            }
          }
        }
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }

    expect(
      terminalStatus,
      'implement pipeline_run never reached terminal status'
    ).toBe('completed');
    expect(implementRunId).toBeTruthy();
    expect(
      prRowExists,
      'deploy bridge never wrote issue_pull_request row for implement stage'
    ).toBe(true);

    // ── Assertions (collected; don't short-circuit on first failure) ─
    // 1. pipeline_run.status = completed (already asserted above)

    // 2. pipeline_run.artifacts_path is populated and shape-correct.
    const [pipelineRunRow] = await sql<
      { artifacts_path: string | null }[]
    >`SELECT artifacts_path FROM "pipeline_run"
        WHERE "id" = ${implementRunId!}`;
    const artifactsPath = pipelineRunRow?.artifacts_path ?? null;
    expect(
      artifactsPath,
      'pipeline_run.artifacts_path must be populated for implement run'
    ).toBeTruthy();
    expect(
      artifactsPath,
      `pipeline_run.artifacts_path shape: ${artifactsPath}`
    ).toMatch(/\.fluxaos-artifacts\/[0-9a-f-]+\/?$/);

    if (artifactsPath) {
      artifactDirsToRemove.push(artifactsPath);
    }

    // 3. research-findings.md exists at <artifacts_path> and is non-empty.
    const findingsPath = path.join(artifactsPath!, 'research-findings.md');
    expect(
      existsSync(findingsPath),
      `research-findings.md missing at ${findingsPath}`
    ).toBe(true);
    const findingsStat = statSync(findingsPath);
    expect(findingsStat.size, 'research-findings.md is empty').toBeGreaterThan(
      0
    );

    // 4. implement stage's stage_run has ≥1 event whose payload
    // mentions research-findings.md — proves consumption.
    const [implementStageRun] = await sql<
      { id: string }[]
    >`SELECT sr.id FROM "stage_run" sr
        JOIN "pipeline_stage" ps ON ps."id" = sr."pipeline_stage_id"
        WHERE sr."pipeline_run_id" = ${implementRunId!}
          AND ps."name" = 'implement'
        ORDER BY sr."created_at" DESC LIMIT 1`;
    expect(
      implementStageRun,
      'no implement stage_run recorded for the run'
    ).toBeTruthy();

    const events = await sql<
      { type: string; payload: Record<string, unknown> }[]
    >`SELECT type, payload FROM "event"
        WHERE "stage_run_id" = ${implementStageRun.id}`;
    expect(
      events.length,
      'implement stage_run has no transcript events'
    ).toBeGreaterThan(0);

    const consumed = events.some((e) =>
      JSON.stringify(e.payload ?? {}).includes('research-findings.md')
    );
    expect(
      consumed,
      'no implement-stage event payload references research-findings.md'
    ).toBe(true);

    // 5. Artifacts dir still exists on disk after worktree release.
    expect(
      existsSync(artifactsPath!),
      `artifacts dir must persist after worktree release: ${artifactsPath}`
    ).toBe(true);

    // 6. R-RUNTIME assertions still hold.
    const [issueAfter] = await sql<
      { state_key: string | null }[]
    >`SELECT s."key" AS state_key
        FROM "issue" i
        JOIN "issue_state" s ON s."id" = i."state_id"
        WHERE i."id" = ${issueRow.id}`;
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
    >`SELECT id, pr_url, pr_number, state, head_branch
        FROM "issue_pull_request"
        WHERE "issue_id" = ${issueRow.id}`;
    expect(prRows, 'expected exactly one PR row').toHaveLength(1);
    const prRow = prRows[0];
    expect(prRow.pr_url, 'pr_url must be populated').toBeTruthy();
    expect(prRow.pr_number, 'pr_number must be populated').toBeTruthy();
    expect(prRow.state).toBe('open');

    const branchRows = await sql<
      { branch_name: string }[]
    >`SELECT branch_name FROM "issue_branch"
        WHERE "issue_id" = ${issueRow.id}`;
    expect(branchRows, 'expected exactly one branch row').toHaveLength(1);
    const branchName = branchRows[0].branch_name;
    expect(branchName).toMatch(/^fluxaos\/issue-1-/);

    const isoRows = await sql<
      { status: string; working_path: string }[]
    >`SELECT status, working_path FROM "isolation_environment"
        WHERE "run_id" = ${implementRunId!}`;
    expect(
      isoRows,
      'expected exactly one isolation_environment row for implement run'
    ).toHaveLength(1);
    expect(isoRows[0].status, 'isolation_environment must be cleaned up').toBe(
      'inactive'
    );

    expect(
      existsSync(isoRows[0].working_path),
      `worktree directory not removed: ${isoRows[0].working_path}`
    ).toBe(false);

    // ── GitHub confirms branch + PR exist on the remote ────────────
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

    openedPRs.push({
      owner,
      repo: repoName,
      prNumber: prRow.pr_number!,
      branchName,
    });

    // Read findings for the log (helpful diagnostic on failure).
    const findings = await readFile(findingsPath, 'utf8');
    console.log(`[r-artifacts] research-findings.md length=${findings.length}`);

    // ── Final gate: no console/page errors during UI drive ─────────
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

  // ── Teardown ─────────────────────────────────────────────────────────
  test.afterAll(async () => {
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
          `[teardown] failed to close PR #${pr.prNumber} on ${pr.owner}/${pr.repo}: ${(err as Error).message}`
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
          `[teardown] failed to delete ref heads/${pr.branchName} on ${pr.owner}/${pr.repo}: ${(err as Error).message}`
        );
      }
    }

    // rm -rf the artifacts dirs so the next journey run starts fresh.
    for (const dir of artifactDirsToRemove) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch (err) {
        console.warn(
          `[teardown] failed to rm artifacts dir ${dir}: ${(err as Error).message}`
        );
      }
    }
  });
});
