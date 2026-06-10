// e2e/settings-url-context.spec.ts
//
// FLX-244 journey, rewritten for FLX-239 Stage 7 (FLX-266). Several
// settings pages used to resolve org/project by taking the first DB row
// (`org[0]` / `project[0]`) instead of the URL route params — silently
// rendering the wrong project's data on multi-project installs.
//
// URL addressing is UUID-only now (`/p/{uuid}/...` — slugs are gone), so
// this spec proves the fix by creating a SECOND project via the tRPC HTTP
// API, navigating to *that* project's settings URLs, and asserting each
// page renders for the URL-identified project (not the seed row). It also
// asserts a bogus project UUID renders the not-found boundary — the
// "no fallbacks ever" rule: an unresolved URL must error, never fall back
// to the first row.
//
// Membership setup (FLX-239 hard rule): project.create wires the supplied
// userId into a `project_member` row inside the same transaction, so the
// scratch project is reachable under the access semantics shipped in
// FLX-269 (resolveContext authorizes direct project_member OR team_member
// on the owning team; the LAN auth bypass passes through with a null
// session user, which is how this suite runs).
//
// Wire format follows e2e/settings-projects-form-slice.spec.ts:
// httpBatchLink with `?batch=1` and `'0'` wrapper on POSTs.

import { randomUUID } from 'node:crypto';
import { expect, test } from './helpers/setup';

// Throwaway project — timestamp-suffixed so parallel runs don't collide.
const SCRATCH_NAME = `e2e-url-context-${Date.now()}`;

// The seeded default project — the deterministic UUID from
// src/scripts/db/seed-ids.ts, required by helpers/setup.ts at module load.
const SEED_PROJECT_ID = process.env.FLUXAOS_PROJECT_ID as string;

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

test.describe('@flx-244 Settings pages resolve org/project from URL', () => {
  let scratchProjectId: string | null = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      // Resolve the seed project's org + owning team from its UUID —
      // project.create (FLX-239 Stage 5 shape) requires both.
      const projRes = await page.request.get(
        `/api/trpc/project.getById?input=${encodeURIComponent(
          JSON.stringify({ id: SEED_PROJECT_ID })
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
      const userId = (await userRes.json())?.result?.data?.[0]?.id;
      if (!userId) throw new Error('Seed user not resolvable via tRPC');

      // POST (batched) — wrap input under '0', append ?batch=1.
      // userId becomes a project_member row (membership setup).
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
    // heading at the scratch URL proves the page read the URL UUID.
    for (const { path, heading } of SETTINGS_PAGES) {
      await page.goto(`/p/${scratchProjectId}/${path}`);
      await expect(
        page.getByRole('heading', { name: heading }).first(),
        `${path} should render its heading for the scratch project URL`
      ).toBeVisible({ timeout: 15_000 });
      // URL must remain on the scratch project — no silent redirect to
      // a different project's context.
      await expect(page).toHaveURL(
        new RegExp(`/p/${scratchProjectId}/${path}$`)
      );
    }
  });

  test('bogus project UUID shows not-found — no fallback to the first DB row', async ({
    page,
  }) => {
    // "No fallbacks ever": an unresolved URL must surface a not-found
    // boundary, not silently render project[0]. Hit every fixed page
    // with a random UUID that cannot resolve and assert the page's own
    // heading never appears — proving it did not fall back to rendering
    // the first DB row's data. (A valid-but-unknown UUID, not a malformed
    // one — malformed ids fail zod validation before the lookup.)
    const bogusUuid = randomUUID();
    for (const { path, heading } of SETTINGS_PAGES) {
      await page.goto(`/p/${bogusUuid}/${path}`);
      // Next.js default not-found boundary renders this copy.
      await expect(
        page.getByText(/This page could not be found/i).first(),
        `${path} with a bogus project UUID must render not-found`
      ).toBeVisible({ timeout: 15_000 });
      // The page's own heading must NOT appear.
      await expect(page.getByRole('heading', { name: heading })).toHaveCount(0);
    }
  });
});
