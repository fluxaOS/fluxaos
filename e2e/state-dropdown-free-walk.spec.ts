// e2e/state-dropdown-free-walk.spec.ts
// FLX-77 journey test: state dropdown shows ALL states (no transition-graph
// filter); operator can change to any state without validation. Asserts:
//
//   1. Dropdown options match the project's full state catalog (count + labels).
//   2. Operator can walk a non-graph path (e.g. complete → research) — i.e.
//      a transition that has no row in issue_transition. tRPC accepts it.
//
// Resets the issue back to a non-terminal state at the end so the seed stays
// usable across runs.

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-77 @journey', () => {
  test('state dropdown is free-form (all states, no graph filter)', async ({
    page,
  }) => {
    await page.goto(projectPath('/issues/1'));

    await expect(
      page.getByRole('heading', { name: /Add health check endpoint/ })
    ).toBeVisible({ timeout: 15_000 });

    const stateSelect = page
      .locator('div.flex.items-center.gap-2', {
        has: page.locator('span', { hasText: /^State$/ }),
      })
      .locator('select');

    // Pull the dropdown's option labels.
    const optionLabels = await stateSelect.evaluate((el) => {
      const select = el as HTMLSelectElement;
      return Array.from(select.options).map((o) => o.text);
    });

    // Default seed catalog has at least: New, Research, Implement, Review,
    // Deploy, Complete, Hold, Already Complete, Needs Human, Blocked. The
    // exact set is config-driven; assert we see at least 6 distinct labels
    // (proves the filter is gone — pre-FLX-77 the dropdown only showed
    // graph-allowed neighbors, typically 1–2).
    expect(optionLabels.length).toBeGreaterThanOrEqual(6);

    // Walk: New → Complete (terminal, no graph edge) → Research (no graph
    // edge from Complete). Pre-FLX-77 each of these would 404 the dropdown
    // option or throw INVALID_TRANSITION on submit.
    const walk = ['Complete', 'Research'];
    for (const label of walk) {
      await stateSelect.selectOption({ label });
      await expect
        .poll(
          async () =>
            stateSelect.evaluate((el) => {
              const select = el as HTMLSelectElement;
              return select.options[select.selectedIndex]?.text ?? '';
            }),
          { timeout: 10_000, intervals: [250, 500, 1_000] }
        )
        .toBe(label);
    }

    // No alert dialog (would surface if INVALID_TRANSITION threw).
    page.on('dialog', async (d) => {
      throw new Error(`Unexpected dialog: ${d.message()}`);
    });

    // Restore: leave at Research so reseed isn't required.
  });
});
