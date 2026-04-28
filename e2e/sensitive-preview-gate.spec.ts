// FLX-11: sensitive prompt-template fields are blurred behind a Preview
// button by default in the viewing state. Edit mode bypasses the gate.

import { expect, gotoSettings, test } from './helpers/setup';

test.describe('@flx-11 @settings @sensitive-gate', () => {
  test('driver prompt template is gated until Preview is clicked', async ({
    page,
  }) => {
    await gotoSettings(page, 'drivers');
    await expect(page.getByText('Claude Code')).toBeVisible();
    await page.getByText('Claude Code').first().click();
    await expect(
      page.getByRole('heading', { name: 'Claude Code' })
    ).toBeVisible();

    // Both prompt templates render the gate UI, not the underlying text.
    const issueGate = page.getByTestId('sensitive-gate-Issue prompt template');
    const queueGate = page.getByTestId('sensitive-gate-Queue prompt template');
    await expect(issueGate).toBeVisible();
    await expect(queueGate).toBeVisible();

    // The gate has a Preview button per field. Use locator scoping so we
    // only target the issue-template gate.
    const issueTemplateText = '{{skill_name}}: {{issue_title}}';
    const queueTemplateText = '{{issue_title}}';

    // The blurred placeholder DIV is aria-hidden, so getByText with
    // exact-match would find the visible textarea-rendered template only
    // after Preview is clicked. Confirm the *clickable* template isn't
    // there yet — expressed by the Preview button still present.
    await expect(
      issueGate.getByRole('button', { name: 'Preview' })
    ).toBeVisible();

    // Click Preview on the issue template only.
    await issueGate.getByRole('button', { name: 'Preview' }).click();

    // Issue template is now revealed: the textarea contains the seeded
    // template text, and the Preview button is gone for this field.
    await expect(
      page.getByLabel('Issue prompt template')
    ).toHaveValue(new RegExp(issueTemplateText.replace(/[{}]/g, '\\$&')));
    await expect(
      issueGate.getByRole('button', { name: 'Preview' })
    ).toHaveCount(0);

    // Queue template is still gated.
    await expect(queueGate).toBeVisible();
    await expect(
      queueGate.getByRole('button', { name: 'Preview' })
    ).toBeVisible();

    // Click Edit — the gate bypasses for the queue template too because
    // edit mode reveals everything.
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(
      page.getByLabel('Queue prompt template')
    ).toHaveValue(new RegExp(queueTemplateText.replace(/[{}]/g, '\\$&')));
    await expect(page.getByTestId('sensitive-gate-Queue prompt template')).toHaveCount(
      0
    );

    // Cancel — back to viewing; both gates re-applied. Reveal state from
    // before Edit must NOT persist (edit-flip resets revealed=false).
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(
      page.getByTestId('sensitive-gate-Issue prompt template')
    ).toBeVisible();
    await expect(
      page.getByTestId('sensitive-gate-Queue prompt template')
    ).toBeVisible();
  });
});
