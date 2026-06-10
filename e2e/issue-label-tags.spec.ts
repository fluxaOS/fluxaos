// FLX-42: issue labels should commit multiple tags from delimiters.

import 'dotenv/config';
import postgres from 'postgres';
import { resetDb } from './helpers/reset-db';
import { expect, projectPath, test } from './helpers/setup';

const DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const HAS_DB = !!DATABASE_URL;

test.describe('@flx-42 @ui', () => {
  test.skip(!HAS_DB, 'requires DATABASE_URL or DIRECT_URL');
  test.setTimeout(60_000);

  test.beforeAll(async () => {
    await resetDb();
  });

  test('label input splits delimiters, dedupes, truncates, and persists', async ({
    page,
  }) => {
    const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });
    try {
      await page.goto(projectPath('/issues/1'));
      await expect(
        page.getByRole('heading', { name: /Add health check endpoint/ })
      ).toBeVisible({ timeout: 15_000 });

      const labelsGroup = page.getByRole('group', { name: 'Labels' });
      const labelInput = labelsGroup.getByRole('textbox', { name: 'Labels' });
      await labelInput.fill(`alpha, beta gamma alpha ${'x'.repeat(80)}`);

      await expect(labelsGroup.getByText('alpha')).toBeVisible();
      await expect(labelsGroup.getByText('beta')).toBeVisible();
      await expect(labelsGroup.getByText('gamma')).toBeVisible();
      await expect(labelsGroup.getByText('x'.repeat(64))).toBeVisible();
      await expect(labelInput).toHaveValue('');

      await expect
        .poll(() => loadIssueLabels(sql), {
          timeout: 10_000,
          intervals: [250, 500, 1_000],
        })
        .toEqual(['alpha', 'beta', 'gamma', 'x'.repeat(64)]);
    } finally {
      await sql.end();
    }
  });
});

async function loadIssueLabels(sql: postgres.Sql): Promise<string[]> {
  const [row] = await sql<{ labels: string[] }[]>`
    SELECT labels FROM "issue" WHERE number = 1 LIMIT 1
  `;
  return row?.labels ?? [];
}
