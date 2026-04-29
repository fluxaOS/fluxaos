import postgres from 'postgres';
import { expect, projectPath, test } from './helpers/setup';

const DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

test.describe('@activity @journey', () => {
  test.skip(!DATABASE_URL, 'requires DATABASE_URL (or DIRECT_URL)');

  test('activity feed shows stage completion remarks', async ({ page }) => {
    const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
    const marker = `Stage remark ${Date.now()}: reviewed docs and verified links.`;

    const [issueRow] = await sql<{ id: string }[]>`
      SELECT id FROM "issue" WHERE "number" = 1 LIMIT 1
    `;
    expect(issueRow, 'seed must produce issue #1').toBeTruthy();

    await sql`
      INSERT INTO "issue_event" ("issue_id", "actor", "type", "payload")
      VALUES (
        ${issueRow.id},
        'stage-runner',
        'stage_completed',
        ${sql.json({
          stageName: 'review',
          stageRunId: '00000000-0000-0000-0000-000000000001',
          exitCode: 0,
          skillSignal: 'proceed',
          summary: marker,
        })}
      )
    `;

    try {
      await page.goto(projectPath('/issues/1'));
      const feed = page.getByTestId('activity-feed');
      await expect(feed).toBeVisible({ timeout: 45_000 });
      await expect(feed.getByText(marker)).toBeVisible({ timeout: 15_000 });
    } finally {
      await sql`
        DELETE FROM "issue_event"
        WHERE "issue_id" = ${issueRow.id}
          AND "payload"->>'summary' = ${marker}
      `;
      await sql.end();
    }
  });
});
