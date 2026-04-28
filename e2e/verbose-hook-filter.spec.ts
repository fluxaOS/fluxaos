// FLX-47: verbose mode must hide hook/init lifecycle entries by default,
// surface them via the Show hooks toggle.

import 'dotenv/config';
import { execSync } from 'node:child_process';
import path from 'node:path';
import postgres from 'postgres';
import { expect, projectPath, test } from './helpers/setup';

const DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const HAS_DB = !!DATABASE_URL;
const REPO_ROOT = path.resolve(__dirname, '..');

const HOOK_TEXT = 'FLX-47 init lifecycle entry — should be hidden by default';
const TEXT_TEXT = 'FLX-47 normal output entry — always visible';

test.describe('@flx-47 @ui @transcript', () => {
  test.skip(!HAS_DB, 'requires DATABASE_URL or DIRECT_URL');
  test.setTimeout(60_000);

  test.beforeAll(() => {
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
  });

  test('verbose mode hides hook/init system entries until Show hooks toggled', async ({
    page,
  }) => {
    const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
    try {
      await seedHookFixture(sql);

      await page.goto(projectPath('/issues/1'));
      await expect(
        page.getByRole('heading', { name: /Add health check endpoint/ })
      ).toBeVisible({ timeout: 15_000 });

      await expect(
        page.getByRole('heading', { name: 'Run History' })
      ).toBeVisible();

      await page
        .getByRole('button', { name: /View Research Run Details/i })
        .click();

      const dialog = page.getByRole('dialog', { name: 'Run detail' });
      await expect(dialog).toBeVisible({ timeout: 15_000 });

      // Normal text entry shows in default (non-verbose) view
      await expect(dialog.getByText(TEXT_TEXT)).toBeVisible();
      // System entries not visible at all in non-verbose
      await expect(dialog.getByText(HOOK_TEXT)).toHaveCount(0);
      // Show hooks toggle is hidden until Verbose is enabled
      await expect(dialog.getByTestId('show-hooks-toggle')).toHaveCount(0);

      // Enable Verbose — Show hooks appears, but hook entry still hidden
      await dialog.getByLabel('Verbose').check();
      await expect(dialog.getByTestId('show-hooks-toggle')).toBeVisible();
      await expect(dialog.getByText(HOOK_TEXT)).toHaveCount(0);
      await expect(dialog.getByText(TEXT_TEXT)).toBeVisible();

      // Enable Show hooks — init entry now visible
      await dialog.getByLabel('Show hooks').check();
      await expect(dialog.getByText(HOOK_TEXT)).toBeVisible();

      // Disable Show hooks — init entry hidden again
      await dialog.getByLabel('Show hooks').uncheck();
      await expect(dialog.getByText(HOOK_TEXT)).toHaveCount(0);

      // Raw JSON view always shows the underlying event regardless of hook filter
      await dialog.getByLabel('Raw JSON').check();
      await expect(dialog.getByText(/"systemSubtype":\s*"init"/)).toBeVisible();
    } finally {
      await sql.end();
    }
  });
});

async function seedHookFixture(
  sql: postgres.Sql<Record<string, unknown>>
): Promise<void> {
  const [issueRow] = await sql<{ id: string }[]>`
    SELECT id FROM "issue" WHERE number = 1 LIMIT 1
  `;
  const [pipelineRow] = await sql<{ id: string }[]>`
    SELECT id FROM "pipeline" WHERE "is_default" = true LIMIT 1
  `;
  const stages = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM "pipeline_stage" WHERE "pipeline_id" = ${pipelineRow.id}
  `;
  const researchStage = stages.find((stage) => stage.name === 'research');

  expect(issueRow, 'seed issue #1 missing').toBeTruthy();
  expect(pipelineRow, 'default pipeline missing').toBeTruthy();
  expect(researchStage, 'research stage missing').toBeTruthy();

  const [run] = await sql<{ id: string }[]>`
    INSERT INTO "pipeline_run" (
      "pipeline_id", "issue_id", "status",
      "started_at", "completed_at", "created_at", "updated_at"
    )
    VALUES (
      ${pipelineRow.id}, ${issueRow.id}, 'completed',
      now() - interval '5 minutes', now() - interval '4 minutes',
      now() - interval '5 minutes', now() - interval '4 minutes'
    )
    RETURNING id
  `;
  const [stageRun] = await sql<{ id: string }[]>`
    INSERT INTO "stage_run" (
      "pipeline_run_id", "pipeline_stage_id", "status", "exit_code",
      "started_at", "completed_at", "created_at", "updated_at"
    )
    VALUES (
      ${run.id}, ${researchStage!.id}, 'completed', 0,
      now() - interval '5 minutes', now() - interval '4 minutes',
      now() - interval '5 minutes', now() - interval '4 minutes'
    )
    RETURNING id
  `;

  // Plain text entry — always visible
  await sql`
    INSERT INTO "event" ("stage_run_id", "type", "payload", "timestamp", "created_at")
    VALUES (
      ${stageRun.id}, 'output',
      ${sql.json({
        id: 'flx-47-text',
        kind: 'text',
        lineNumber: 1,
        text: TEXT_TEXT,
      })},
      now() - interval '4 minutes 30 seconds',
      now() - interval '4 minutes 30 seconds'
    )
  `;
  // System entry with subtype 'init' — should hide unless Show hooks toggled
  await sql`
    INSERT INTO "event" ("stage_run_id", "type", "payload", "timestamp", "created_at")
    VALUES (
      ${stageRun.id}, 'output',
      ${sql.json({
        id: 'flx-47-init',
        kind: 'system',
        lineNumber: 2,
        text: HOOK_TEXT,
        systemSubtype: 'init',
      })},
      now() - interval '4 minutes 25 seconds',
      now() - interval '4 minutes 25 seconds'
    )
  `;
}
