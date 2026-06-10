// R-EPIC hierarchy journey.
// Drives the UI + tRPC to verify:
//   1. RelationshipsCard renders parent + children.
//   2. Run Stage disables + shows epic hint when the parent has open children.
//   3. pipeline.runs.trigger server-side guard rejects with ISSUE_IS_EPIC.
//   4. Walking the child through the state machine to terminal auto-closes
//      the parent and renders the "Auto-closed — all child issues closed"
//      activity-feed label.
// No external creds — pure state journey, self-contained.

import postgres from 'postgres';
import { resetDb } from './helpers/reset-db';
import { expect, projectPath, test } from './helpers/setup';

const DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL (or DIRECT_URL) must be set for e2e tests');
}

/** Walk a single tRPC issue.transition call against the dev server.
 *  Relative URL — page.request resolves it against the configured
 *  Playwright baseURL (one source of truth, no port fallbacks). */
async function transition(
  page: import('@playwright/test').Page,
  issueId: string,
  toStateId: string,
  version: number,
  projectId: string
): Promise<void> {
  const resp = await page.request.post(`/api/trpc/issue.transition?batch=1`, {
    data: { '0': { id: issueId, projectId, toStateId, version } },
  });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(
      `issue.transition to ${toStateId} failed: ${resp.status()} ${body}`
    );
  }
}

test.describe('@r-epic @journey', () => {
  test.setTimeout(3 * 60_000);

  test('parent with open child rejects Run Stage; child close auto-closes parent', async ({
    page,
  }) => {
    await resetDb();

    const sql = postgres(DATABASE_URL!, { max: 2, prepare: false });

    try {
      // Issue #1 becomes the parent.
      const [parentRow] = await sql<
        {
          id: string;
          project_id: string;
          number: number;
          version: number;
        }[]
      >`SELECT id, project_id, number, version FROM "issue" WHERE "number" = 1 LIMIT 1`;
      expect(parentRow, 'seed did not produce issue #1').toBeTruthy();

      // ── Step 1: visit parent pre-child, confirm RelationshipsCard renders
      // the "Create child issue" affordance.
      await page.goto(projectPath(`/issues/${parentRow.number}`));
      await expect(
        page.getByRole('heading', { name: /Add health check/ })
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByRole('link', { name: /Create child issue/i })
      ).toBeVisible();

      // ── Step 2: create a child via the UI's create-child link (exercises
      // ?parent= search-param plumbing + the banner + the tRPC mutation).
      await page.getByRole('link', { name: /Create child issue/i }).click();
      await page.waitForURL(/\/issues\/new\?parent=/);
      await expect(page.getByText(/Creating child issue under/i)).toBeVisible();

      await page.getByPlaceholder('Issue title').fill('Child of #1');
      await page.getByRole('button', { name: /Create Issue/ }).click();

      await page.waitForURL(/\/issues\/\d+$/);
      const childMatch = page.url().match(/\/issues\/(\d+)$/);
      const childNumber = Number(childMatch?.[1]);
      expect(childNumber).toBeGreaterThan(parentRow.number);

      // ── Step 3: return to parent. RelationshipsCard now lists the child;
      // Run Stage becomes disabled with the hint once we advance to a state
      // that maps to a pipeline stage.
      await page.goto(projectPath(`/issues/${parentRow.number}`));
      await expect(
        page.getByRole('heading', { name: /Add health check/ })
      ).toBeVisible({ timeout: 15_000 });

      // Child is in the children list.
      await expect(
        page.getByRole('link', {
          name: new RegExp(`#${childNumber}.*Child of #1`),
        })
      ).toBeVisible();

      // Advance parent "new" → "research" so Run Stage matches a pipeline
      // stage and becomes render-eligible.
      const stateSelect = page
        .locator('div.flex.items-center.gap-2', {
          has: page.locator('span', { hasText: /^State$/ }),
        })
        .locator('select');
      await stateSelect.selectOption({ label: 'Research' });

      const runStageBtn = page.getByRole('button', { name: /Run Stage/ });
      await expect(runStageBtn).toBeVisible({ timeout: 10_000 });
      await expect(runStageBtn).toBeDisabled();
      await expect(
        page.getByText(/This issue has open child issues/i)
      ).toBeVisible();

      // ── Step 4: server-side guard fires independently.
      const [researchStageRow] = await sql<
        { id: string; pipeline_id: string }[]
      >`SELECT id, pipeline_id FROM "pipeline_stage" WHERE name='research' LIMIT 1`;
      const guardResp = await page.request.post(
        `/api/trpc/pipeline.runs.trigger?batch=1`,
        {
          data: {
            '0': {
              pipelineId: researchStageRow.pipeline_id,
              issueId: parentRow.id,
              stageId: researchStageRow.id,
            },
          },
        }
      );
      expect(guardResp.ok()).toBe(false);
      expect(await guardResp.text()).toContain('ISSUE_IS_EPIC');

      // ── Step 5: walk the child through the seed's transition graph to a
      // terminal state. Seed ships: new → research → implement → review
      // → deploy → complete. "complete" is isTerminal=true; hitting that
      // transition fires maybeAutoCloseParent.
      const stateRows = await sql<{ id: string; key: string }[]>`
          SELECT id, key FROM "issue_state"
          WHERE project_id = ${parentRow.project_id}
        `;
      const stateByKey = new Map(stateRows.map((s) => [s.key, s.id]));

      const walk = [
        'research',
        'implement',
        'review',
        'deploy',
        'complete',
      ] as const;

      let childVersion = 1;
      const [childRow0] = await sql<{ id: string }[]>`
          SELECT id FROM "issue" WHERE number = ${childNumber}
        `;

      for (const key of walk) {
        const toId = stateByKey.get(key)!;
        await transition(
          page,
          childRow0.id,
          toId,
          childVersion,
          parentRow.project_id
        );
        childVersion += 1;
      }

      // ── Step 6: parent should now be closed. Reload parent page and
      // assert the auto-close activity-feed label + is_closed.
      await page.goto(projectPath(`/issues/${parentRow.number}`));
      await expect(
        page.getByRole('heading', { name: /Add health check/ })
      ).toBeVisible({ timeout: 15_000 });

      await expect(
        page.getByText(/Auto-closed.*all child issues closed/i).first()
      ).toBeVisible({ timeout: 10_000 });

      const [parentAfter] = await sql<{ is_closed: boolean }[]>`
          SELECT is_closed FROM "issue" WHERE id = ${parentRow.id}
        `;
      expect(parentAfter.is_closed).toBe(true);

      // Run Stage should stay disabled — the parent is now closed, and
      // the child is also closed. But since isEpic key is hasOpenChildren
      // (not "any children") and all children are now closed, the parent
      // is no longer an epic in the ruleset. isClosed alone currently
      // doesn't gate the button in the UI — verify we at least don't
      // regress the "hint gone" side.
      await expect(
        page.getByText(/This issue has open child issues/i)
      ).toBeHidden();
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
