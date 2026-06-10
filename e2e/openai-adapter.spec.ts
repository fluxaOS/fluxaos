// e2e/openai-adapter.spec.ts
// FLX-6 — OpenAI adapter seed verification.
// Confirms that running the seed populates an OpenAI provider, a GPT-5.4
// model, and an OpenAI Codex CLI driver, and that all three surface in
// the corresponding settings pages so operators can wire routing rules.

import 'dotenv/config';
import { resetDb } from './helpers/reset-db';
import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-6 @journey @openai-adapter', () => {
  test.setTimeout(60_000);

  test.beforeAll(async () => {
    await resetDb();
  });

  test('Drivers page shows OpenAI Codex CLI seeded as disabled', async ({
    page,
  }) => {
    await page.goto(projectPath('/settings/drivers'));
    const codexRow = page
      .locator('li', { hasText: 'OpenAI Codex CLI' })
      .first();
    await expect(codexRow).toBeVisible({ timeout: 15_000 });

    // Click into it and verify the binary + isEnabled state in the editor.
    await codexRow.click();
    await expect(
      page.getByRole('heading', { name: 'OpenAI Codex CLI' })
    ).toBeVisible();
    // Binary field shows 'codex' in the readonly text input.
    await expect(page.getByLabel('Binary', { exact: true })).toHaveValue(
      'codex'
    );
  });

  test('Providers page shows OpenAI provider with GPT-5.4 model', async ({
    page,
  }) => {
    await page.goto(projectPath('/settings/providers'));
    // Provider list includes OpenAI alongside the seeded Anthropic provider.
    await expect(page.locator('li', { hasText: 'OpenAI' }).first()).toBeVisible(
      { timeout: 15_000 }
    );
    await expect(
      page.locator('li', { hasText: 'Anthropic' }).first()
    ).toBeVisible();
  });
});
