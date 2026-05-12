// e2e/settings-projects-form-slice.spec.ts
//
// FLX-207 / FLX-226 / FLX-227 / FLX-229 journey. Exercises the full
// Projects form lifecycle: dropdown selections, repoUrl validate,
// slug rename confirm + redirect.
//
// All slug-rename testing happens on a throwaway project created via
// the API at beforeAll and deleted at afterAll. The seed project is
// only used for the read-only form structure assertions (no readonly
// inputs remain, etc.) and dropdown-select tests on fields that are
// safely re-savable.

import { expect, test } from '@playwright/test';

// Seed slugs — confirmed from src/scripts/db/seed.ts (org='default',
// user='admin', project='fluxaos'). If the seed changes, update these.
const SEED_ORG = 'default';
const SEED_USER = 'admin';
const SEED_PROJECT = 'fluxaos';

// Throwaway project slugs for the slug-rename test. Timestamp-suffixed
// so parallel runs don't collide on the unique (userId, slug) index.
const SCRATCH_SLUG = `e2e-projects-form-${Date.now()}`;
const SCRATCH_RENAMED = `${SCRATCH_SLUG}-renamed`;

test.describe('@flx-207 @flx-226 @flx-229 Projects form slice', () => {
  test('seed project: read-only structure + dropdown + repo validate (happy path)', async ({
    page,
  }) => {
    await page.goto(
      `/${SEED_ORG}/${SEED_USER}/${SEED_PROJECT}/settings/projects`
    );

    // Wait for the projects list to hydrate before assertions.
    await expect(
      page.getByRole('heading', { name: 'Projects', exact: true })
    ).toBeVisible({ timeout: 15_000 });

    // No readonly inputs remain on the form (FLX-207). The readonly
    // visual treatment is reserved for fields that genuinely cannot be
    // edited; Projects form has none after this slice.
    await expect(page.locator('[aria-readonly="true"]')).toHaveCount(0);

    // Select the row (RecordEditor list-row pattern) so the detail
    // panel mounts, then click Edit.
    await page.locator('li', { hasText: SEED_PROJECT }).first().click();
    await page
      .getByRole('button', { name: /^Edit$/, exact: false })
      .first()
      .click();

    // Pipeline dropdown is enabled and has at least the null option
    // plus the seeded pipeline.
    const pipelineSelect = page.getByLabel('Default pipeline');
    await expect(pipelineSelect).toBeEnabled();
    const pipelineOptions = await pipelineSelect
      .locator('option')
      .allInnerTexts();
    expect(pipelineOptions.length).toBeGreaterThan(1);
    await pipelineSelect.selectOption({ index: 1 });

    // Brand dropdown: select the null option explicitly to verify
    // (no brand) writes null.
    const brandSelect = page.getByLabel('Default brand');
    await brandSelect.selectOption({ value: '' });

    // Validate repoUrl with a real public repo. Network call goes
    // through the validateRepoUrl tRPC endpoint backed by the GitHub
    // validator from FLX-227.
    const repoInput = page.getByTestId('repo-url-input-repoUrl');
    await repoInput.fill('https://github.com/fluxaOS/fluxaos');
    await page.getByTestId('repo-url-validate').click();
    await expect(page.getByTestId('repo-url-validity-ok')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('seed project: repoUrl validation surfaces error for non-existent repo', async ({
    page,
  }) => {
    await page.goto(
      `/${SEED_ORG}/${SEED_USER}/${SEED_PROJECT}/settings/projects`
    );
    await expect(
      page.getByRole('heading', { name: 'Projects', exact: true })
    ).toBeVisible({ timeout: 15_000 });
    await page.locator('li', { hasText: SEED_PROJECT }).first().click();
    await page
      .getByRole('button', { name: /^Edit$/, exact: false })
      .first()
      .click();

    const repoInput = page.getByTestId('repo-url-input-repoUrl');
    await repoInput.fill(
      'https://github.com/flux-not-a-real-org/flux-not-a-real-repo'
    );
    await page.getByTestId('repo-url-validate').click();
    await expect(page.getByTestId('repo-url-validity-error')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('repo-url-validity-error')).toContainText(
      'Repository not found'
    );
  });

  // ─── slug rename tests use a throwaway project ─────────────────────────
  //
  // The slug rename test MUST NOT mutate the seed project. beforeAll
  // creates a scratch project via the tRPC HTTP API; afterAll deletes
  // it. Wire format follows e2e/r-smoke.spec.ts:66-69 — httpBatchLink
  // with `?batch=1` and `'0'` wrapper on POSTs.

  test.describe('slug rename (throwaway project)', () => {
    let scratchProjectId: string | null = null;

    test.beforeAll(async ({ browser }) => {
      const page = await browser.newPage();
      try {
        const orgRes = await page.request.get(
          `/api/trpc/organization.getBySlug?input=${encodeURIComponent(
            JSON.stringify({ slug: SEED_ORG })
          )}`
        );
        if (!orgRes.ok())
          throw new Error(
            `organization.getBySlug failed: ${orgRes.status()} ${await orgRes.text()}`
          );
        const orgJson = await orgRes.json();
        const orgId = orgJson?.result?.data?.id;
        if (!orgId) throw new Error('Seed org not resolvable via tRPC');

        const userRes = await page.request.get(
          `/api/trpc/user.list?input=${encodeURIComponent(
            JSON.stringify({ orgId })
          )}`
        );
        if (!userRes.ok())
          throw new Error(
            `user.list failed: ${userRes.status()} ${await userRes.text()}`
          );
        const userJson = await userRes.json();
        const userId = userJson?.result?.data?.[0]?.id;
        if (!userId) throw new Error('Seed user not resolvable via tRPC');

        // POST (batched) — must wrap input under '0' and append ?batch=1.
        const createRes = await page.request.post(
          '/api/trpc/project.create?batch=1',
          {
            data: {
              '0': {
                orgId,
                userId,
                name: SCRATCH_SLUG,
                slug: SCRATCH_SLUG,
              },
            },
          }
        );
        if (!createRes.ok())
          throw new Error(
            `project.create failed: ${createRes.status()} ${await createRes.text()}`
          );
        const createJson = await createRes.json();
        // Batched response is an array of `{ result: { data } }`; pull [0].
        scratchProjectId =
          createJson?.[0]?.result?.data?.id ??
          createJson?.result?.data?.id ??
          null;
        if (!scratchProjectId)
          throw new Error(
            `scratch project create returned no id: ${JSON.stringify(createJson)}`
          );
      } finally {
        await page.close();
      }
    });

    test.afterAll(async ({ browser }) => {
      if (!scratchProjectId) return;
      const page = await browser.newPage();
      try {
        await page.request.post('/api/trpc/project.delete?batch=1', {
          data: { '0': { id: scratchProjectId } },
        });
      } catch {
        // Best-effort cleanup; don't fail the suite on teardown errors.
      } finally {
        await page.close();
      }
    });

    test('cancel keeps current slug', async ({ page }) => {
      await page.goto(
        `/${SEED_ORG}/${SEED_USER}/${SCRATCH_SLUG}/settings/projects`
      );
      await expect(
        page.getByRole('heading', { name: 'Projects', exact: true })
      ).toBeVisible({ timeout: 15_000 });
      await page.locator('li', { hasText: SCRATCH_SLUG }).first().click();
      await page
        .getByRole('button', { name: /^Edit$/, exact: false })
        .first()
        .click();

      const slugInput = page.getByLabel('Slug', { exact: true });
      await slugInput.fill(SCRATCH_RENAMED);
      await page.getByRole('button', { name: /^Save$/, exact: false }).click();

      // Modal appears; click Cancel and confirm URL did not change.
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByTestId('confirm-modal-cancel').click();

      await expect(page).toHaveURL(
        new RegExp(
          `/${SEED_ORG}/${SEED_USER}/${SCRATCH_SLUG}/settings/projects$`
        )
      );
    });

    test('confirm redirects to new slug', async ({ page }) => {
      await page.goto(
        `/${SEED_ORG}/${SEED_USER}/${SCRATCH_SLUG}/settings/projects`
      );
      await expect(
        page.getByRole('heading', { name: 'Projects', exact: true })
      ).toBeVisible({ timeout: 15_000 });
      await page.locator('li', { hasText: SCRATCH_SLUG }).first().click();
      await page
        .getByRole('button', { name: /^Edit$/, exact: false })
        .first()
        .click();

      const slugInput = page.getByLabel('Slug', { exact: true });
      await slugInput.fill(SCRATCH_RENAMED);
      await page.getByRole('button', { name: /^Save$/, exact: false }).click();
      await page.getByTestId('confirm-modal-confirm').click();

      await expect(page).toHaveURL(
        new RegExp(
          `/${SEED_ORG}/${SEED_USER}/${SCRATCH_RENAMED}/settings/projects$`
        ),
        { timeout: 10_000 }
      );
    });
  });
});
