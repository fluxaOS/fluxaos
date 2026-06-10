import { projectPath, test } from './helpers/setup';

test('capture hydration errors on dashboard', async ({ page }) => {
  const hydrationErrors: string[] = [];
  const pageErrors: Error[] = [];

  page.on('pageerror', (err) => pageErrors.push(err));
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      hydrationErrors.push(msg.text());
    }
  });

  // FLX-239 Stage 7: UUID-only routing — observe the real dashboard, not
  // the retired slug URL (which 404s and would make this check vacuous).
  await page.goto(projectPath('/'));
  await page.waitForTimeout(3000);

  console.log('=== CONSOLE ERRORS/WARNINGS ===');
  for (const e of hydrationErrors) console.log(e);
  console.log('=== PAGE ERRORS ===');
  for (const e of pageErrors) console.log(e.message);
});
