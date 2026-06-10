// FLX-26: active run duration should tick while RunDetailModal stays open.

import 'dotenv/config';
import postgres from 'postgres';
import { resetDb } from './helpers/reset-db';
import { expect, projectPath, test } from './helpers/setup';

const DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const HAS_DB = !!DATABASE_URL;

test.describe('@flx-26 @ui', () => {
  test.skip(!HAS_DB, 'requires DATABASE_URL or DIRECT_URL');
  test.setTimeout(60_000);

  test.beforeAll(async () => {
    await resetDb();
  });

  test('running run duration advances while detail modal remains open', async ({
    page,
  }) => {
    const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
    try {
      await seedRunningRun(sql);

      await page.goto(projectPath('/issues/1'));
      await expect(
        page.getByRole('heading', { name: /Add health check endpoint/ })
      ).toBeVisible({ timeout: 15_000 });

      await page
        .getByRole('button', { name: /^View Details$/ })
        .first()
        .click();
      await expect(
        page.getByRole('dialog', { name: 'Run detail' })
      ).toBeVisible({ timeout: 15_000 });

      const durationValue = page
        .locator('div.flex.items-start.gap-2', {
          has: page.locator('span', { hasText: /^Duration$/ }),
        })
        .locator('div')
        .first();

      await expect(durationValue).toHaveText(/1m \d+s/);
      const initialDuration = await durationValue.textContent();

      await expect
        .poll(() => durationValue.textContent(), {
          timeout: 3_500,
          intervals: [500, 1_000],
          message: 'duration did not tick while modal stayed open',
        })
        .not.toBe(initialDuration);
    } finally {
      await sql.end();
    }
  });
});

async function seedRunningRun(
  sql: postgres.Sql<Record<string, unknown>>
): Promise<void> {
  const [issueRow] = await sql<{ id: string }[]>`
    SELECT id FROM "issue" WHERE number = 1 LIMIT 1
  `;
  const [pipelineRow] = await sql<{ id: string }[]>`
    SELECT id FROM "pipeline" WHERE "is_default" = true LIMIT 1
  `;
  const [researchStage] = await sql<{ id: string }[]>`
    SELECT id
    FROM "pipeline_stage"
    WHERE "pipeline_id" = ${pipelineRow.id} AND name = 'research'
    LIMIT 1
  `;

  expect(issueRow, 'seed issue #1 missing').toBeTruthy();
  expect(pipelineRow, 'default pipeline missing').toBeTruthy();
  expect(researchStage, 'research stage missing').toBeTruthy();

  const [run] = await sql<{ id: string }[]>`
    INSERT INTO "pipeline_run" (
      "pipeline_id",
      "issue_id",
      "status",
      "started_at",
      "created_at",
      "updated_at"
    )
    VALUES (
      ${pipelineRow.id},
      ${issueRow.id},
      'running',
      now() - interval '65 seconds',
      now() - interval '65 seconds',
      now()
    )
    RETURNING id
  `;

  await sql`
    INSERT INTO "stage_run" (
      "pipeline_run_id",
      "pipeline_stage_id",
      "status",
      "started_at",
      "created_at",
      "updated_at"
    )
    VALUES (
      ${run.id},
      ${researchStage.id},
      'running',
      now() - interval '65 seconds',
      now() - interval '65 seconds',
      now()
    )
  `;
}
