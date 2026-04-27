// e2e/closed-issue-indicator.spec.ts
// FLX-27 journey test: closed issues display the "Closed" badge on the
// list and detail views, and the list row shows line-through styling on
// the title link.
//
// Walks issue #1 through the seeded transition chain
// (new → implement → review → deploy → complete). The "complete" state
// has isTerminal=true, which the issue service uses to set isClosed=true
// + closedAt at transition time. Then asserts:
//
//   1. Detail view header renders the Closed badge.
//   2. List view row has opacity-60, the title link has line-through,
//      and a Closed pill renders next to the title.
//
// This spec resets the issue back to "new" at the end so the seed state
// stays clean across runs (no DB nuke required between test invocations).

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-27 @journey', () => {
  test('closed issues render Closed badge on detail + list', async ({
    page,
  }) => {
    await page.goto(projectPath('/issues/1'));

    await expect(
      page.getByRole('heading', { name: /Add health check endpoint/ })
    ).toBeVisible({ timeout: 15_000 });

    // The State select container holds a <span>State</span> sibling with
    // a <select> whose option text matches state displayName. Match the
    // pattern used by real-anthropic-stage-run.spec.ts.
    const stateSelect = page
      .locator('div.flex.items-center.gap-2', {
        has: page.locator('span', { hasText: /^State$/ }),
      })
      .locator('select');

    // Walk new → implement → review → deploy → complete. The "Skip
    // research" transition (new → implement) is in the seeded graph, so
    // four selects total. After each transition the StateSelect rebuilds
    // its options from server state, so we re-resolve the locator each
    // step (no stale element handles).
    const targets = ['Implement', 'Review', 'Deploy', 'Complete'];
    for (const label of targets) {
      await stateSelect.selectOption({ label });
      // Wait for the select's selected option to reflect the new state
      // (the transition mutation persists, query refetches, the State
      // dropdown's options rebuild from the new transitions, and the
      // selected option becomes `label`).
      await expect
        .poll(
          async () => {
            const value = await stateSelect.evaluate((el) => {
              const select = el as HTMLSelectElement;
              return select.options[select.selectedIndex]?.text ?? '';
            });
            return value;
          },
          { timeout: 10_000, intervals: [250, 500, 1_000] }
        )
        .toBe(label);
    }

    // Detail-view assertion: Closed badge renders in the header next to
    // the State + Priority badges. Background is bg-slate-700/40,
    // text-slate-400, includes a small dot. Match by exact text.
    const closedBadgeDetail = page.getByText('Closed', { exact: true });
    await expect(closedBadgeDetail).toBeVisible({ timeout: 10_000 });

    // Navigate to issue list. Default lifecycle filter is "Open", so a
    // closed issue won't render — switch to "All Issues" first so the
    // row is queryable. Use waitUntil:'networkidle' because the dev
    // server can intercept the first goto with an HMR error overlay
    // ("missing required error components, refreshing...") if a code
    // edit is mid-flight; networkidle gives that loop time to settle.
    await page.goto(projectPath('/issues'), { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible({
      timeout: 15_000,
    });

    const lifecycleSelect = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'All Issues' }) })
      .first();
    await lifecycleSelect.selectOption('all');

    // Find issue #1's row by its number cell.
    const row = page.locator('tr', {
      has: page.locator('td', { hasText: /^1$/ }),
    });
    await expect(row).toHaveClass(/opacity-60/);

    const titleLink = row.getByRole('link', {
      name: /Add health check endpoint/,
    });
    await expect(titleLink).toHaveClass(/line-through/);

    // Closed pill renders inside the title cell next to the link.
    await expect(row.getByText('Closed', { exact: true })).toBeVisible();

    // Restore: walk back to "new" so the seed state stays clean across
    // runs. The seeded transition graph allows complete → implement
    // (Reopen) and implement → research; from research we don't have a
    // direct edge back to new, so leave it at "research" — the next
    // nuke + reseed will reset it. (db:seed is the canonical reset.)
    await page.goto(projectPath('/issues/1'));
    await expect(
      page.getByRole('heading', { name: /Add health check endpoint/ })
    ).toBeVisible({ timeout: 15_000 });

    const stateSelect2 = page
      .locator('div.flex.items-center.gap-2', {
        has: page.locator('span', { hasText: /^State$/ }),
      })
      .locator('select');
    await stateSelect2.selectOption({ label: 'Implement' });
    await expect
      .poll(
        async () => {
          return stateSelect2.evaluate((el) => {
            const select = el as HTMLSelectElement;
            return select.options[select.selectedIndex]?.text ?? '';
          });
        },
        { timeout: 10_000, intervals: [250, 500, 1_000] }
      )
      .toBe('Implement');

    // Closed badge should be gone on a re-opened issue (isClosed flips
    // back to false because the target state is non-terminal).
    await expect(page.getByText('Closed', { exact: true })).toBeHidden();
  });
});
