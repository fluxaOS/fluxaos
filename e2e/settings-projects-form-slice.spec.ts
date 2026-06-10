// e2e/settings-projects-form-slice.spec.ts
//
// FLX-207 / FLX-226 / FLX-227 / FLX-229 journey. Exercises the full
// Projects form lifecycle: dropdown selections, repoUrl validate,
// name rename persistence.
//
// FLX-271 (FLX-239 Stage 8): project.slug was dropped, so the former
// slug-rename confirm + redirect flow no longer exists. The rename tests
// now cover the name field and assert the slug field is gone.
//
// All rename testing happens on a throwaway project created via
// the API at beforeAll and deleted at afterAll. The seed project is
// only used for the read-only form structure assertions (no readonly
// inputs remain, etc.) and dropdown-select tests on fields that are
// safely re-savable.

import { expect, projectPath, test } from './helpers/setup';

// Seed project display name — confirmed from src/scripts/db/seed.ts.
// URL addressing is UUID-only (FLX-239 Stage 7); the RecordEditor list
// still renders the display name.
const SEED_PROJECT_NAME = 'fluxaOS';

// Throwaway project names for the rename test. Timestamp-suffixed so
// parallel runs don't collide.
const SCRATCH_NAME = `e2e-projects-form-${Date.now()}`;
const SCRATCH_RENAMED = `${SCRATCH_NAME}-renamed`;

test.describe('@flx-207 @flx-226 @flx-229 Projects form slice', () => {
  test('seed project: read-only structure + dropdown + repo validate (happy path)', async ({
    page,
  }) => {
    await page.goto(projectPath('/settings/projects'));

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
    await page.locator('li', { hasText: SEED_PROJECT_NAME }).first().click();
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
    await page.goto(projectPath('/settings/projects'));
    await expect(
      page.getByRole('heading', { name: 'Projects', exact: true })
    ).toBeVisible({ timeout: 15_000 });
    await page.locator('li', { hasText: SEED_PROJECT_NAME }).first().click();
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

  // ─── rename tests use a throwaway project ──────────────────────────────
  //
  // The rename test MUST NOT mutate the seed project. beforeAll
  // creates a scratch project via the tRPC HTTP API; afterAll deletes
  // it. Wire format follows e2e/r-smoke.spec.ts:66-69 — httpBatchLink
  // with `?batch=1` and `'0'` wrapper on POSTs.
  //
  // FLX-239 Stage 7: org + owning team resolve from the seed project's
  // UUID; project.create (Stage 5 shape) requires orgId + teamId + userId
  // and wires the user into a project_member row.

  test.describe('name rename (throwaway project)', () => {
    let scratchProjectId: string | null = null;

    test.beforeAll(async ({ browser }) => {
      const page = await browser.newPage();
      try {
        const projRes = await page.request.get(
          `/api/trpc/project.getById?input=${encodeURIComponent(
            JSON.stringify({ id: process.env.FLUXAOS_PROJECT_ID })
          )}`
        );
        if (!projRes.ok())
          throw new Error(
            `project.getById failed: ${projRes.status()} ${await projRes.text()}`
          );
        const seedProject = (await projRes.json())?.result?.data;
        const orgId = seedProject?.orgId;
        const teamId = seedProject?.teamId;
        if (!orgId || !teamId)
          throw new Error('Seed project not resolvable via tRPC');

        const userRes = await page.request.get(
          `/api/trpc/user.listByOrg?input=${encodeURIComponent(
            JSON.stringify({ orgId })
          )}`
        );
        if (!userRes.ok())
          throw new Error(
            `user.listByOrg failed: ${userRes.status()} ${await userRes.text()}`
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
                teamId,
                userId,
                name: SCRATCH_NAME,
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

    test('project form has no slug field (FLX-271)', async ({ page }) => {
      await page.goto(projectPath('/settings/projects'));
      await expect(
        page.getByRole('heading', { name: 'Projects', exact: true })
      ).toBeVisible({ timeout: 15_000 });
      await page.locator('li', { hasText: SCRATCH_NAME }).first().click();
      await page
        .getByRole('button', { name: /^Edit$/, exact: false })
        .first()
        .click();

      // FLX-271: tenancy slugs were dropped in FLX-239 Stage 8 — no Slug
      // input may remain anywhere on the Projects form.
      await expect(page.getByLabel('Slug', { exact: true })).toHaveCount(0);
    });

    test('name rename persists (URL unchanged — UUID routes)', async ({
      page,
    }) => {
      await page.goto(projectPath('/settings/projects'));
      await expect(
        page.getByRole('heading', { name: 'Projects', exact: true })
      ).toBeVisible({ timeout: 15_000 });
      await page.locator('li', { hasText: SCRATCH_NAME }).first().click();
      await page
        .getByRole('button', { name: /^Edit$/, exact: false })
        .first()
        .click();

      const nameInput = page.getByLabel('Name', { exact: true });
      await nameInput.fill(SCRATCH_RENAMED);
      await page.getByRole('button', { name: /^Save$/, exact: false }).click();

      // The rename persists on the row and the UUID URL does not change.
      const renamedRow = page.locator('li', { hasText: SCRATCH_RENAMED });
      await expect(renamedRow.first()).toBeVisible({ timeout: 10_000 });
      await expect(page).toHaveURL(/\/settings\/projects$/);
    });
  });
});
