// e2e/flx-264-failed-stage-error-banner.spec.ts
//
// FLX-264: a failed stage must SURFACE stage_run.error_message in the
// RunDetailModal (Invariant 9 — fail fast, surface the error). Before this
// fix a failed stage with no output/gates rendered a blank "No output yet."
// while the engine had recorded an actionable error_message.
//
// Canonical failure recipe: a project whose `target_repo_path` is null.
// The fixture clones the seeded default project's issue catalogs, automation
// config, and pipeline into a brand-new project that never gets a
// target_repo_path, then files an issue on it via the UI — same surface as a
// human. The live daemon dispatches the run and the first stage fails fast
// at isolation-env acquire time (the stage-runner's missing-repo-path
// guard), recording stage_run.error_message. The spec opens the Run Detail
// modal and asserts the EXACT recorded error text is visible: the banner is
// generic — it renders whatever the engine recorded, no special-casing.

import 'dotenv/config';
import postgres from 'postgres';
import { expect, test } from './helpers/setup';

const DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const HAS_DB = !!DATABASE_URL;

// setup.ts already fail-fasts when this is missing.
const SEED_PROJECT_ID = process.env.FLUXAOS_PROJECT_ID!;

// Acquire fails before any AI call, so the run flips to failed quickly —
// the budget only covers daemon dispatch latency.
const FAILED_TIMEOUT_MS = 120_000;

/** Fixture project id, shared with afterAll cleanup. */
let fixtureProjectId: string | null = null;

test.describe('@flx-264 @journey', () => {
  test.skip(!HAS_DB, 'requires DATABASE_URL or DIRECT_URL');
  test.setTimeout(FAILED_TIMEOUT_MS + 120_000);

  test.afterAll(async () => {
    if (!fixtureProjectId) return;
    const sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    try {
      // Park the fixture issue so a daemon restart sweep does not
      // re-dispatch it into an endless fail loop. The fixture rows stay —
      // the next resetDb()/nuke clears them.
      await sql`
        UPDATE issue SET is_closed = true
        WHERE project_id = ${fixtureProjectId}
      `;
    } finally {
      await sql.end();
    }
  });

  test('failed stage surfaces stage_run.error_message in the Run Detail modal', async ({
    page,
  }) => {
    const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
    try {
      const brokenProjectId = await seedProjectWithoutTargetRepoPath(sql);
      fixtureProjectId = brokenProjectId;

      // ── 1. File an issue on the broken project via the UI ──────────────
      await page.goto(`/p/${brokenProjectId}/issues/new`);
      await expect(
        page.getByRole('heading', { name: 'New Issue' })
      ).toBeVisible({ timeout: 15_000 });

      const uniqueTitle = `FLX-264 surfaced failure ${Date.now()}`;
      await page.getByPlaceholder('Issue title').fill(uniqueTitle);
      await page
        .getByPlaceholder('Describe the issue (Markdown)')
        .fill(
          'FLX-264 journey: this project has no target_repo_path, so the first stage must fail fast and the error must be visible in the Run Detail modal.'
        );
      await page.getByRole('button', { name: /Create Issue/ }).click();

      await expect(
        page.getByRole('heading', { name: new RegExp(uniqueTitle) })
      ).toBeVisible({ timeout: 15_000 });

      // ── 2. Wait for the daemon to dispatch + fail the run ──────────────
      const runStatus = page.locator('p', { hasText: /^Run:\s/ }).first();
      await expect
        .poll(
          async () => {
            await page.reload();
            const text = await runStatus
              .textContent({ timeout: 5_000 })
              .catch(() => null);
            if (!text) return null;
            const match = text.match(/Run:\s*(\w+)/);
            return match?.[1] ?? null;
          },
          {
            timeout: FAILED_TIMEOUT_MS,
            intervals: [2_000, 5_000],
            message:
              'Pipeline run did not reach `failed`. Check daemon logs — ' +
              'the fixture project has no target_repo_path, so the first ' +
              'stage must fail at isolation-env acquire.',
          }
        )
        .toBe('failed');

      // ── 3. Read the error the engine recorded ──────────────────────────
      const [stageRunRow] = await sql<{ error_message: string | null }[]>`
        SELECT sr.error_message
        FROM stage_run sr
        JOIN pipeline_run pr ON pr.id = sr.pipeline_run_id
        JOIN issue i ON i.id = pr.issue_id
        WHERE i.project_id = ${brokenProjectId}
        ORDER BY sr.created_at DESC
        LIMIT 1
      `;
      expect(
        stageRunRow?.error_message,
        'engine must record stage_run.error_message on the failed stage'
      ).toBeTruthy();
      const recordedError = stageRunRow!.error_message!;
      // Sanity: the fixture produced the intended failure mode.
      expect(recordedError).toContain('target_repo_path');

      // ── 4. Open the Run Detail modal and assert the error is visible ───
      await page.getByRole('button', { name: 'View Details' }).first().click();
      await expect(
        page.getByRole('dialog', { name: 'Run detail' })
      ).toBeVisible({ timeout: 15_000 });

      // The failed-stage banner renders the recorded error verbatim.
      await expect(page.getByTestId('stage-error-message')).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByTestId('stage-error-message')).toHaveText(
        recordedError
      );
    } finally {
      await sql.end();
    }
  });
});

/**
 * Create a project that can receive issues and dispatch pipeline runs but
 * whose `target_repo_path` is null — the canonical FLX-264 failure recipe.
 *
 * Clones from the seeded default project: issue states/statuses/types/
 * priorities, project-scoped config entries (status automation keys), and
 * the default pipeline with its stages. Grants membership to the seeded
 * user so the viewer can access the project pages.
 */
async function seedProjectWithoutTargetRepoPath(
  sql: postgres.Sql<Record<string, unknown>>
): Promise<string> {
  const [seedProject] = await sql<
    { org_id: string; team_id: string; default_pipeline_id: string | null }[]
  >`
    SELECT org_id, team_id, default_pipeline_id
    FROM project WHERE id = ${SEED_PROJECT_ID}
  `;
  expect(seedProject, 'seed project missing').toBeTruthy();
  expect(
    seedProject.default_pipeline_id,
    'seed project has no default pipeline'
  ).toBeTruthy();

  const [member] = await sql<{ user_id: string }[]>`
    SELECT user_id FROM project_member
    WHERE project_id = ${SEED_PROJECT_ID} LIMIT 1
  `;
  expect(member, 'seed project has no member').toBeTruthy();

  // Clone repo_url/default_branch from the seed project so acquisition gets
  // past the repoUrl precondition and fails at the target_repo_path guard —
  // the canonical FLX-264 failure. target_repo_path stays null.
  const [proj] = await sql<{ id: string }[]>`
    INSERT INTO project
      (org_id, team_id, name, repo_url, default_branch, worktree_copy_files)
    SELECT org_id, team_id,
           ${`FLX-264 missing repo path ${Date.now()}`},
           repo_url, default_branch, worktree_copy_files
    FROM project WHERE id = ${SEED_PROJECT_ID}
    RETURNING id
  `;

  await sql`
    INSERT INTO project_member (user_id, project_id)
    VALUES (${member.user_id}, ${proj.id})
  `;

  // Issue catalogs — required by issue creation (non-terminal state +
  // on-create status) and the issue UI.
  await sql`
    INSERT INTO issue_state
      (project_id, key, display_name, description, color, sort_order, is_active, is_terminal)
    SELECT ${proj.id}, key, display_name, description, color, sort_order, is_active, is_terminal
    FROM issue_state WHERE project_id = ${SEED_PROJECT_ID}
  `;
  await sql`
    INSERT INTO issue_status
      (project_id, key, display_name, description, sort_order, is_active)
    SELECT ${proj.id}, key, display_name, description, sort_order, is_active
    FROM issue_status WHERE project_id = ${SEED_PROJECT_ID}
  `;
  await sql`
    INSERT INTO issue_type
      (project_id, key, display_name, description, color, sort_order, is_active)
    SELECT ${proj.id}, key, display_name, description, color, sort_order, is_active
    FROM issue_type WHERE project_id = ${SEED_PROJECT_ID}
  `;
  await sql`
    INSERT INTO issue_priority
      (project_id, key, display_name, description, color, weight, is_active)
    SELECT ${proj.id}, key, display_name, description, color, weight, is_active
    FROM issue_priority WHERE project_id = ${SEED_PROJECT_ID}
  `;

  // Project-scoped automation config (issues.status.on_create_key etc.) —
  // the issue-watcher refuses to dispatch without the on-create key.
  await sql`
    INSERT INTO config_entry (scope, project_id, key, value)
    SELECT scope, ${proj.id}, key, value
    FROM config_entry WHERE project_id = ${SEED_PROJECT_ID}
  `;

  // Clone the default pipeline + stages so the daemon has something to run.
  const [pipe] = await sql<{ id: string }[]>`
    INSERT INTO pipeline (project_id, name, description, is_default)
    SELECT ${proj.id}, name, description, is_default
    FROM pipeline WHERE id = ${seedProject.default_pipeline_id}
    RETURNING id
  `;
  await sql`
    INSERT INTO pipeline_stage
      (pipeline_id, name, sort_order, persona_id, driver, timeout_sec,
       max_retries, gate_mode, gate_rules, on_pass, on_fail, fallback, driver_id)
    SELECT ${pipe.id}, name, sort_order, persona_id, driver, timeout_sec,
           max_retries, gate_mode, gate_rules, on_pass, on_fail, fallback, driver_id
    FROM pipeline_stage WHERE pipeline_id = ${seedProject.default_pipeline_id}
  `;
  await sql`
    UPDATE project SET default_pipeline_id = ${pipe.id} WHERE id = ${proj.id}
  `;

  // The one thing this fixture must NOT have:
  const [check] = await sql<{ target_repo_path: string | null }[]>`
    SELECT target_repo_path FROM project WHERE id = ${proj.id}
  `;
  expect(check.target_repo_path).toBeNull();

  return proj.id;
}
