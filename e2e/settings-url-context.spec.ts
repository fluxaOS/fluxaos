// e2e/settings-url-context.spec.ts
//
// FLX-244 journey. Several settings pages used to resolve org/project
// by taking the first DB row (`org[0]` / `project[0]`) instead of the
// `[org]/[user]/[project]` URL route params — silently rendering the
// wrong project's data on multi-project installs.
//
// This spec proves the fix by creating a SECOND project via the tRPC
// HTTP API, navigating to *that* project's settings URLs, and asserting
// each page renders for the URL-identified project (not the seed row).
// It also asserts a bogus project slug renders the not-found boundary —
// the "no fallbacks ever" rule: an unresolved URL must error, never
// fall back to the first row.
//
// Wire format follows e2e/settings-projects-form-slice.spec.ts:
// httpBatchLink with `?batch=1` and `'0'` wrapper on POSTs.

import { expect, test } from '@playwright/test';

// Seed slugs — confirmed from src/scripts/db/seed.ts.
const SEED_ORG = 'default';
const SEED_USER = 'admin';

// Throwaway project — timestamp-suffixed so parallel runs don't collide
// on the unique (userId, slug) index.
const SCRATCH_SLUG = `e2e-url-context-${Date.now()}`;

// Settings pages that previously pivoted off org[0]/project[0].
// Each must render its heading when reached via the scratch project's
// URL — proving it resolved the project from the URL, not the first row.
const SETTINGS_PAGES: Array<{ path: string; heading: RegExp }> = [
  { path: 'settings/cron', heading: /Cron Jobs/ },
  { path: 'settings/teams', heading: /Teams/ },
  { path: 'settings/routing', heading: /Routing Profiles/ },
  { path: 'settings/providers', heading: /Providers/ },
  { path: 'settings/users', heading: /Users/ },
  { path: 'settings', heading: /Pipeline Settings/ },
  { path: 'kpis', heading: /KPIs/ },
];

// FLX-239 Stage 1: skipped. This spec fails for two compounding reasons:
//   (1) its beforeAll calls project.create with `userId` — column dropped
//       in Stage 1 schema; router shape updated in Stage 5.
//   (2) it navigates to /{org}/{user}/{scratch}/settings/teams — old URL
//       tree, dropped in Stage 4 (with the 307 redirect scaffold).
// Both must be addressed before the spec runs again; rewrite in Stage 7.
test.describe.skip('@flx-244 Settings pages resolve org/project from URL', () => {
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
      const orgId = (await orgRes.json())?.result?.data?.id;
      if (!orgId) throw new Error('Seed org not resolvable via tRPC');

      const userRes = await page.request.get(
        `/api/trpc/user.listByOrg?input=${encodeURIComponent(
          JSON.stringify({ orgId })
        )}`
      );
      if (!userRes.ok())
        throw new Error(
          `user.listByOrg failed: ${userRes.status()} ${await userRes.text()}`
        );
      const userId = (await userRes.json())?.result?.data?.[0]?.id;
      if (!userId) throw new Error('Seed user not resolvable via tRPC');

      // POST (batched) — wrap input under '0', append ?batch=1.
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

  test('scratch project: each settings page renders for the URL-identified project', async ({
    page,
  }) => {
    // The seed project is project[0] in the DB. If any page still
    // pivoted off project[0], navigating to the SCRATCH project's URL
    // would either render the seed project's data or — with the
    // notFound() guard — never reach a stable heading. A visible
    // heading at the scratch URL proves the page read the URL slug.
    for (const { path, heading } of SETTINGS_PAGES) {
      await page.goto(`/${SEED_ORG}/${SEED_USER}/${SCRATCH_SLUG}/${path}`);
      await expect(
        page.getByRole('heading', { name: heading }).first(),
        `${path} should render its heading for the scratch project URL`
      ).toBeVisible({ timeout: 15_000 });
      // URL must remain on the scratch project — no silent redirect to
      // a different project's context.
      await expect(page).toHaveURL(
        new RegExp(`/${SEED_ORG}/${SEED_USER}/${SCRATCH_SLUG}/${path}$`)
      );
    }
  });

  test('bogus project slug shows not-found — no fallback to the first DB row', async ({
    page,
  }) => {
    // "No fallbacks ever": an unresolved URL must surface a not-found
    // boundary, not silently render project[0]. Hit every fixed page
    // with a slug that cannot resolve and assert the page's own heading
    // never appears — proving it did not fall back to rendering the
    // first DB row's data.
    const bogusSlug = `flx-244-no-such-project-${Date.now()}`;
    for (const { path, heading } of SETTINGS_PAGES) {
      await page.goto(`/${SEED_ORG}/${SEED_USER}/${bogusSlug}/${path}`);
      // Next.js default not-found boundary renders this copy.
      await expect(
        page.getByText(/This page could not be found/i).first(),
        `${path} with a bogus project slug must render not-found`
      ).toBeVisible({ timeout: 15_000 });
      // The page's own heading must NOT appear.
      await expect(page.getByRole('heading', { name: heading })).toHaveCount(0);
    }
  });
});
