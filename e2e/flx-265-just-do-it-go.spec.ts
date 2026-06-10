// e2e/flx-265-just-do-it-go.spec.ts
//
// FLX-265: the Dashboard "Just Do It" Go button must be WIRED — it creates
// an issue in the current project via the same tRPC mutation as the New
// Issue form (title from the prompt text, first active type/priority from
// the project catalogs) and navigates to the created issue's page, where
// auto-dispatch and the pipeline take over. Before this fix the form's
// onSubmit only called preventDefault(): zero requests, no navigation, no
// error — a dead headline CTA.
//
// Journey: open the project dashboard, type a task description, click Go,
// assert navigation to the new issue page with the matching title, then
// assert the live daemon dispatches a pipeline run for it (the "Run: ..."
// indicator appears — that's the product working).

import 'dotenv/config';
import postgres from 'postgres';
import { expect, projectPath, test } from './helpers/setup';

const DATABASE_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const HAS_DB = !!DATABASE_URL;

// setup.ts already fail-fasts when this is missing.
const SEED_PROJECT_ID = process.env.FLUXAOS_PROJECT_ID!;

// Only daemon dispatch latency is in the budget — we assert the run was
// dispatched (indicator appears), not that it reaches a terminal status.
const DISPATCH_TIMEOUT_MS = 120_000;

/** Created issue title, shared with afterAll cleanup. */
let createdIssueTitle: string | null = null;

test.describe('@flx-265 @journey', () => {
  test.skip(!HAS_DB, 'requires DATABASE_URL or DIRECT_URL');
  test.setTimeout(DISPATCH_TIMEOUT_MS + 120_000);

  test.afterAll(async () => {
    if (!createdIssueTitle) return;
    const sql = postgres(DATABASE_URL!, { max: 1, prepare: false });
    try {
      // Park the created issue so a daemon restart sweep does not
      // re-dispatch it. The row stays — the next resetDb()/nuke clears it.
      await sql`
        UPDATE issue SET is_closed = true
        WHERE project_id = ${SEED_PROJECT_ID}
          AND title = ${createdIssueTitle}
      `;
    } finally {
      await sql.end();
    }
  });

  test('Go creates an issue from the prompt and the daemon dispatches it', async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    // ── 1. Open the project dashboard ────────────────────────────────────
    await page.goto(projectPath('/'));
    await expect(page.getByRole('heading', { name: 'Just Do It' })).toBeVisible(
      { timeout: 15_000 }
    );

    // ── 2. Type a task description and click Go ──────────────────────────
    const uniqueTitle = `FLX-265 Just Do It journey ${Date.now()} — add a one-line note to README acknowledging this run.`;
    createdIssueTitle = uniqueTitle;
    await page
      .getByPlaceholder('Describe what you want done...')
      .fill(uniqueTitle);
    await page.getByRole('button', { name: 'Go' }).click();

    // ── 3. Navigates to the created issue's page, title matching ─────────
    await expect(page).toHaveURL(/\/issues\/\d+$/, { timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: new RegExp(uniqueTitle) })
    ).toBeVisible({ timeout: 15_000 });

    // ── 4. The live daemon auto-dispatches the issue ──────────────────────
    // The issue detail page renders "Run: {status} · Cost: $..." once the
    // IssueWatcher has dispatched a pipeline_run. Any status counts as
    // dispatched — running, completed, even failed: the CTA's job ended at
    // "issue filed, pipeline engaged".
    const runStatus = page.locator('p', { hasText: /^Run:\s/ }).first();
    await expect
      .poll(
        async () => {
          await page.reload();
          // Bounded read: the indicator may be absent until a later reload;
          // an unbounded textContent() would hang the poll callback.
          const text = await runStatus
            .textContent({ timeout: 5_000 })
            .catch(() => null);
          if (!text) return null;
          const match = text.match(/Run:\s*(\w+)/);
          return match?.[1] ?? null;
        },
        {
          timeout: DISPATCH_TIMEOUT_MS,
          intervals: [2_000, 5_000],
          message:
            'Daemon did not dispatch a pipeline run for the Just Do It ' +
            'issue. Check daemon logs and `npm run db:runs`.',
        }
      )
      .not.toBeNull();

    // No page errors during the journey.
    expect(
      pageErrors,
      `Unexpected pageerror(s): ${pageErrors.map((e) => e.message).join('; ')}`
    ).toHaveLength(0);
  });
});
