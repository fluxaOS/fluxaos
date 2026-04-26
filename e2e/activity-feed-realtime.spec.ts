// e2e/activity-feed-realtime.spec.ts
// R-UI-2.5 smoke: posting a comment causes the activity feed to
// reflect the new comment_added event without a manual page refresh,
// and no console/pageerror fires.
import { expect, projectPath, test } from './helpers/setup';

test.describe('@r-ui-2-5 @smoke', () => {
  test('activity feed updates without manual refresh after posting a comment', async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];

    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Issue #1 exists in the seed ("Add health check endpoint with build metadata").
    await page.goto(projectPath('/issues/1'));

    // Wait for the activity feed to render. Dev-server cold compile can
    // push first-hit compile+hydrate+trpc-query past the default expect
    // timeout, so allow up to 45s here (the test.timeout ceiling is 60s).
    const feed = page.getByTestId('activity-feed');
    await expect(feed).toBeVisible({ timeout: 45_000 });

    // Count current activity items. Works whether the feed is empty ("No
    // activity yet.") or populated — we record the baseline, add a comment,
    // and assert the count grew without touching the browser.
    const initialCount = await feed
      .locator('.relative.flex.items-start')
      .count();

    // Type a unique comment body so we can verify it lands.
    const marker = `smoke-test-${Date.now()}`;
    const textarea = page.getByPlaceholder('Write a comment (Markdown)...');
    await textarea.fill(marker);
    await page.getByRole('button', { name: /^Post Comment$/ }).click();

    // Wait for the new event to appear in the feed WITHOUT any page.reload().
    // The Realtime subscription is responsible for this.
    await expect
      .poll(async () => feed.locator('.relative.flex.items-start').count(), {
        timeout: 15_000,
        message:
          'Activity feed did not update after posting a comment. Realtime subscription may be broken.',
      })
      .toBeGreaterThan(initialCount);

    // Known failure patterns we care about:
    const knownErrorPattern =
      /Adapter ".*" is not registered|Missing required environment variable|Missing Supabase config/;
    const matchedErrors = consoleErrors.filter((e) =>
      knownErrorPattern.test(e)
    );

    expect(
      pageErrors,
      `Unexpected pageerror(s): ${pageErrors.map((e) => e.message).join('; ')}`
    ).toHaveLength(0);
    expect(
      matchedErrors,
      `Unexpected registry/env errors: ${matchedErrors.join('; ')}`
    ).toHaveLength(0);
  });
});
