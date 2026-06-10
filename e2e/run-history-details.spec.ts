// FLX-21: prior pipeline runs must remain reachable after a newer run exists.

import 'dotenv/config';
import postgres from 'postgres';
import { resetDb } from './helpers/reset-db';
import { expect, projectPath, test } from './helpers/setup';

const DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const HAS_DB = !!DATABASE_URL;

test.describe('@flx-21 @ui', () => {
  test.skip(!HAS_DB, 'requires DATABASE_URL or DIRECT_URL');
  test.setTimeout(60_000);

  test.beforeAll(async () => {
    await resetDb();
  });

  test('older run details stay accessible after a newer run is created', async ({
    page,
  }) => {
    const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
    try {
      await seedRunHistoryFixture(sql);

      await page.goto(projectPath('/issues/1'));
      await expect(
        page.getByRole('heading', { name: /Add health check endpoint/ })
      ).toBeVisible({ timeout: 15_000 });

      await expect(
        page.getByRole('heading', { name: 'Run History' })
      ).toBeVisible();

      await expect(
        page.getByRole('button', { name: /View Research Run Details/i })
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: /View Implement Run Details/i })
      ).toBeVisible();

      await page
        .getByRole('button', { name: /View Research Run Details/i })
        .click();

      await expect(
        page.getByRole('dialog', { name: 'Run detail' })
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText('FLX-21 older research output')
      ).toBeVisible();
    } finally {
      await sql.end();
    }
  });
});

async function seedRunHistoryFixture(
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
  const implementStage = stages.find((stage) => stage.name === 'implement');

  expect(issueRow, 'seed issue #1 missing').toBeTruthy();
  expect(pipelineRow, 'default pipeline missing').toBeTruthy();
  expect(researchStage, 'research stage missing').toBeTruthy();
  expect(implementStage, 'implement stage missing').toBeTruthy();

  const [olderRun] = await sql<{ id: string }[]>`
    INSERT INTO "pipeline_run" (
      "pipeline_id",
      "issue_id",
      "status",
      "started_at",
      "completed_at",
      "created_at",
      "updated_at"
    )
    VALUES (
      ${pipelineRow.id},
      ${issueRow.id},
      'completed',
      now() - interval '20 minutes',
      now() - interval '19 minutes',
      now() - interval '20 minutes',
      now() - interval '19 minutes'
    )
    RETURNING id
  `;
  const [olderStageRun] = await sql<{ id: string }[]>`
    INSERT INTO "stage_run" (
      "pipeline_run_id",
      "pipeline_stage_id",
      "status",
      "exit_code",
      "started_at",
      "completed_at",
      "created_at",
      "updated_at"
    )
    VALUES (
      ${olderRun.id},
      ${researchStage!.id},
      'completed',
      0,
      now() - interval '20 minutes',
      now() - interval '19 minutes',
      now() - interval '20 minutes',
      now() - interval '19 minutes'
    )
    RETURNING id
  `;
  await sql`
    INSERT INTO "event" ("stage_run_id", "type", "payload", "timestamp", "created_at")
    VALUES (
      ${olderStageRun.id},
      'output',
      ${sql.json({
        id: 'flx-21-research-output',
        kind: 'text',
        lineNumber: 1,
        text: 'FLX-21 older research output',
      })},
      now() - interval '19 minutes',
      now() - interval '19 minutes'
    )
  `;

  const [newerRun] = await sql<{ id: string }[]>`
    INSERT INTO "pipeline_run" (
      "pipeline_id",
      "issue_id",
      "status",
      "started_at",
      "completed_at",
      "created_at",
      "updated_at"
    )
    VALUES (
      ${pipelineRow.id},
      ${issueRow.id},
      'completed',
      now() - interval '10 minutes',
      now() - interval '9 minutes',
      now() - interval '10 minutes',
      now() - interval '9 minutes'
    )
    RETURNING id
  `;
  const [newerStageRun] = await sql<{ id: string }[]>`
    INSERT INTO "stage_run" (
      "pipeline_run_id",
      "pipeline_stage_id",
      "status",
      "exit_code",
      "started_at",
      "completed_at",
      "created_at",
      "updated_at"
    )
    VALUES (
      ${newerRun.id},
      ${implementStage!.id},
      'completed',
      0,
      now() - interval '10 minutes',
      now() - interval '9 minutes',
      now() - interval '10 minutes',
      now() - interval '9 minutes'
    )
    RETURNING id
  `;
  await sql`
    INSERT INTO "event" ("stage_run_id", "type", "payload", "timestamp", "created_at")
    VALUES (
      ${newerStageRun.id},
      'output',
      ${sql.json({
        id: 'flx-21-implement-output',
        kind: 'text',
        lineNumber: 1,
        text: 'FLX-21 newer implement output',
      })},
      now() - interval '9 minutes',
      now() - interval '9 minutes'
    )
  `;
}
