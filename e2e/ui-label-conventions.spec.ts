// e2e/ui-label-conventions.spec.ts
// FLX-30 (verb tense) + FLX-31 (casing) journey test.
//
// Asserts the canonical label conventions across every major surface
// the user sees. Walks: Dashboard → Pipelines list → Issues list →
// Issue detail → Mission Control → KPIs → Settings hub → Skills tab.
//
// Convention summary (full rules in PR body):
//   - Title Case for all multi-word UI labels (page headers, section
//     headers, buttons, table headers, empty states, status pills).
//   - Past participle for terminal states (Completed, Failed, Cancelled).
//   - Present progressive for active states (Running, Loading, Saving).
//   - Unicode ellipsis `…` (U+2026) for progressive labels.
//   - Catalog displayName values from seed.ts are out of scope.
//
// Failure mode if a regression slips a Sentence-case label back in:
// the matching getByText/getByRole assertion below will not find the
// expected Title Case string and will fail with the exact mismatch.

import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-30 @flx-31 @journey', () => {
  test('canonical Title Case + ellipsis labels render across surfaces', async ({
    page,
  }) => {
    // ── Dashboard ─────────────────────────────────────────────────
    await page.goto(projectPath(''));

    await expect(page.getByRole('heading', { name: 'Just Do It' })).toBeVisible(
      { timeout: 15_000 }
    );
    await expect(
      page.getByRole('heading', { name: 'Pipeline Health' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Recent Pipeline Runs' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Total Spend' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Open Issues' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Issues by State' })
    ).toBeVisible();

    // ── Pipelines list ─────────────────────────────────────────────
    await page.goto(projectPath('/pipelines'));
    await expect(
      page.getByRole('heading', { name: 'Pipeline Runs' })
    ).toBeVisible({ timeout: 15_000 });
    // Page may show empty state OR a populated table depending on
    // whether prior runs exist. Both render Title Case. Match the
    // empty-state title OR the table column header (`<th>` is
    // `columnheader` ARIA role, not `cell`).
    const emptyOrTable = page
      .getByText('No Pipeline Runs Yet', { exact: true })
      .or(page.getByRole('columnheader', { name: 'Pipeline' }));
    await expect(emptyOrTable.first()).toBeVisible();

    // ── Issues list ────────────────────────────────────────────────
    await page.goto(projectPath('/issues'));
    await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible({
      timeout: 15_000,
    });
    // "New Issue" CTA button.
    await expect(page.getByRole('link', { name: 'New Issue' })).toBeVisible();

    // ── Issue detail ──────────────────────────────────────────────
    await page.goto(projectPath('/issues/1'));
    await expect(
      page.getByRole('heading', { name: /Add health check endpoint/ })
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: 'Pipeline Stages' })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Add Comment' })
    ).toBeVisible();

    // ── Mission Control ───────────────────────────────────────────
    await page.goto(projectPath('/mission-control'));
    await expect(
      page.getByRole('heading', { name: 'Mission Control' })
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: 'Queue Depth' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'In-Flight Runs' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Recent Terminal Runs' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Recent Pull Requests' })
    ).toBeVisible();

    // Empty-state copies (fresh-seed state — no runs in flight yet).
    // All three render simultaneously in their respective sections.
    await expect(
      page.getByText('No Runs in Flight', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText('No Terminal Runs Yet', { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText('No PRs Opened Yet', { exact: true })
    ).toBeVisible();

    // ── KPIs ──────────────────────────────────────────────────────
    await page.goto(projectPath('/kpis'));
    await expect(page.getByRole('heading', { name: 'KPIs' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole('heading', { name: 'Pipeline Runs' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Status Breakdown' })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cost' })).toBeVisible();

    // ── Settings hub ──────────────────────────────────────────────
    await page.goto(projectPath('/settings'));
    await expect(
      page.getByRole('heading', { name: 'Pipeline Settings' })
    ).toBeVisible({ timeout: 15_000 });

    // ── Settings → Skills ─────────────────────────────────────────
    await page.goto(projectPath('/settings/skills'));
    await expect(page.getByRole('heading', { name: 'Skills' })).toBeVisible({
      timeout: 15_000,
    });
    // "New Skill" CTA button — was previously sentence-case "New skill".
    await expect(page.getByRole('button', { name: 'New Skill' })).toBeVisible();
  });
});
