import { test } from '@playwright/test';

test('capture hydration errors on dashboard', async ({ page }) => {
  const hydrationErrors: string[] = [];
  const pageErrors: Error[] = [];

  page.on('pageerror', (err) => pageErrors.push(err));
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      hydrationErrors.push(msg.text());
    }
  });

  await page.goto('/default/admin/fluxaos');
  await page.waitForTimeout(3000);

  console.log('=== CONSOLE ERRORS/WARNINGS ===');
  for (const e of hydrationErrors) console.log(e);
  console.log('=== PAGE ERRORS ===');
  for (const e of pageErrors) console.log(e.message);
});
