# FLX-239 Stage 4 Routing Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace active project URLs from `/{org}/{user}/{project}` slugs to `/p/{projectUuid}` while keeping the existing project screens usable.

**Architecture:** Stage 4 creates a new `src/app/p/[projectUuid]/**` route tree and rewrites route context resolution around the project UUID. The route context remains the server-side source of truth for `projectId`, `teamId`, `orgId`, and the current project member `userId`; client navigation builds links from `/p/${projectId}` instead of slug triples. Router procedure scope and feature-row waterfall consumers stay in later stages.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, tRPC v11, Drizzle ORM, Playwright.

---

## Scope Boundary

Implement only FLX-239 Stage 4:

- New active route tree: `src/app/p/[projectUuid]/**`.
- `resolveContext(projectUuid)` resolves by `project.id`, not slugs.
- Existing project pages render under `/p/{uuid}` and generate `/p/{uuid}` links.
- Old `src/app/[org]/[user]/[project]/**` project route tree is removed so old project URLs 404.

Do not do these in Stage 4:

- Do not migrate tRPC authorization or router ownership rules. That is Stage 5.
- Do not wire feature-table reads through `resolveScoped`. That is Stage 6.
- Do not rewrite the full Playwright suite. That is Stage 7.
- Do not drop slug columns. That is Stage 8.

## File Map

Create:

- `src/lib/project-url.ts` - tiny route helpers for `/p/{projectUuid}` base paths.
- `e2e/flx-239-stage-4-routing.spec.ts` - focused route migration smoke proof.

Modify:

- `src/lib/resolve-context.ts` - replace slug waterfall with UUID lookup.
- `src/app/page.tsx` - redirect to `/p/${project.id}`.
- `src/components/nav.tsx` - parse `/p/{projectUuid}` as the project base path.
- `src/components/context-switcher.tsx` - stop parsing slugs from URL; list project choices and link to `/p/{id}`.
- All files moved from `src/app/[org]/[user]/[project]/**` to `src/app/p/[projectUuid]/**`.

Delete:

- `src/app/[org]/**` after copying the project route tree. FLX-239 requires UUID-only URLs; the old org/user project picker is slug-based and is not preserved in Stage 4.

## Task 1: Add Route Helpers

**Files:**
- Create: `src/lib/project-url.ts`

- [ ] **Step 1: Create the helper file**

```ts
export function projectBasePath(projectId: string): string {
  return `/p/${projectId}`;
}

export function projectPath(projectId: string, suffix = ''): string {
  const base = projectBasePath(projectId);
  if (!suffix) return base;
  return `${base}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

export function projectBaseFromPathname(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && segments[0] === 'p') {
    return `/p/${segments[1]}`;
  }
  return '/';
}

export function projectUuidFromPathname(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && segments[0] === 'p') return segments[1];
  return null;
}

export function projectPathSuffix(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length <= 2 || segments[0] !== 'p') return '';
  return `/${segments.slice(2).join('/')}`;
}
```

- [ ] **Step 2: Run the targeted type check**

Run: `npm run build`

Expected: existing mainline TypeScript failures may still appear from Stage 5-7 debt, but there must be no error in `src/lib/project-url.ts`.

- [ ] **Step 3: Commit** - `git add src/lib/project-url.ts && git commit -m "feat(routing): add project UUID URL helpers"`

## Task 2: Rewrite Server Context Resolution

**Files:**
- Modify: `src/lib/resolve-context.ts`

- [ ] **Step 1: Replace slug resolution with project UUID resolution**

Use Drizzle joins directly so the helper can resolve all Stage 4 context in one place without adding new core service surface during the route move.

```ts
/**
 * Resolves org, team, user, and project from the project UUID route.
 */
import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { bootstrap } from '@/config/bootstrap';
import { registry } from '@/config/registry';
import { organization, project, projectMember, team, user } from '@/core/db/schema';
import type { DatabaseProvider } from '@/core/ports/database';

export async function resolveContext(projectUuid: string) {
  bootstrap();
  const db = registry.get<DatabaseProvider>('database').getConnection();

  const [row] = await db
    .select({
      org: organization,
      team,
      user,
      project,
    })
    .from(project)
    .innerJoin(organization, eq(organization.id, project.orgId))
    .innerJoin(team, eq(team.id, project.teamId))
    .innerJoin(projectMember, eq(projectMember.projectId, project.id))
    .innerJoin(
      user,
      and(eq(user.id, projectMember.userId), eq(user.orgId, project.orgId))
    )
    .where(eq(project.id, projectUuid))
    .limit(1);

  if (!row) notFound();

  return {
    db,
    org: row.org,
    team: row.team,
    user: row.user,
    project: row.project,
    orgId: row.org.id,
    teamId: row.team.id,
    userId: row.user.id,
    projectId: row.project.id,
  };
}
```

- [ ] **Step 2: Run the build to find old call sites**

Run: `npm run build`

Expected: pages still calling `resolveContext(org, user, project)` fail. Those failures are the implementation checklist for Task 4.

- [ ] **Step 3: Commit** - `git add src/lib/resolve-context.ts && git commit -m "feat(routing): resolve context by project UUID"`

## Task 3: Move The Project Route Tree

**Files:**
- Create/Move: `src/app/p/[projectUuid]/**`
- Delete: `src/app/[org]/[user]/[project]/**`

- [ ] **Step 1: Create the new route directory**

Run:

```bash
mkdir -p 'src/app/p/[projectUuid]'
cp -R 'src/app/[org]/[user]/[project]/.' 'src/app/p/[projectUuid]/'
```

Expected: `find 'src/app/p/[projectUuid]' -maxdepth 2 -type f` shows the copied route files.

- [ ] **Step 2: Remove the old project route directory**

Run:

```bash
rm -rf 'src/app/[org]/[user]/[project]'
```

Expected: `test ! -d 'src/app/[org]/[user]/[project]'`.

- [ ] **Step 3: Commit the mechanical move** - `git add src/app && git commit -m "refactor(routing): move project app routes under /p"`

## Task 4: Update Server Pages Under `/p/[projectUuid]`

**Files:**
- Modify: `src/app/p/[projectUuid]/page.tsx`
- Modify: `src/app/p/[projectUuid]/mission-control/page.tsx`
- Modify: `src/app/p/[projectUuid]/issues/page.tsx`
- Modify: `src/app/p/[projectUuid]/issues/new/page.tsx`
- Modify: `src/app/p/[projectUuid]/issues/[number]/page.tsx`

- [ ] **Step 1: Update route param types and basePath**

For every server page using `resolveContext`, use this pattern:

```ts
import { projectBasePath } from '@/lib/project-url';
import { resolveContext } from '@/lib/resolve-context';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ projectUuid: string }>;
}) {
  const { projectUuid } = await params;
  const ctx = await resolveContext(projectUuid);
  const basePath = projectBasePath(ctx.project.id);

  return (
    <DashboardClient
      projectId={ctx.project.id}
      projectName={ctx.project.name}
      basePath={basePath}
    />
  );
}
```

For issue detail, preserve `number`:

```ts
params: Promise<{ projectUuid: string; number: string }>;
```

- [ ] **Step 2: Search for stale context calls**

Run:

```bash
rg -n "resolveContext\\(|params: Promise<\\{ org|basePath=\\{`/\\$\\{org\\}" 'src/app/p/[projectUuid]' src/lib
```

Expected: no stale slug-shaped `resolveContext` calls under `src/app/p/[projectUuid]`.

- [ ] **Step 3: Commit** - `git add src/app/p src/lib && git commit -m "feat(routing): update project pages for UUID params"`

## Task 5: Update Client Navigation And Project Lookup

**Files:**
- Modify: `src/components/nav.tsx`
- Modify: `src/components/context-switcher.tsx`
- Modify: client pages under `src/app/p/[projectUuid]/**` that call `trpc.project.getBySlug`

- [ ] **Step 1: Update `Nav` base path parsing**

Replace the local `useBasePath` implementation with:

```ts
import { projectBaseFromPathname } from '@/lib/project-url';

function useBasePath() {
  return projectBaseFromPathname(usePathname());
}
```

- [ ] **Step 2: Update context switcher parsing and links**

Replace slug parsing with project UUID parsing:

```ts
import {
  projectPath,
  projectPathSuffix,
  projectUuidFromPathname,
} from '@/lib/project-url';

const projectUuid = projectUuidFromPathname(pathname);
const suffix = projectPathSuffix(pathname);
```

Use `trpc.project.getById.useQuery({ id: projectUuid })` for the current project. Link project choices with `projectPath(p.id, suffix)` and mark active with `p.id === projectUuid`.

- [ ] **Step 3: Replace project slug tRPC reads in moved pages**

For every page under `src/app/p/[projectUuid]/**` using:

```ts
trpc.project.getBySlug.useQuery({ slug: params.project })
```

replace with:

```ts
const params = useParams<{ projectUuid: string }>();
const currentProjectQuery = trpc.project.getById.useQuery({
  id: params.projectUuid,
});
```

This affects at least `kpis/page.tsx`, `pipelines/[id]/page.tsx`, and every direct settings page under `src/app/p/[projectUuid]/settings/**/page.tsx`.

- [ ] **Step 4: Update local base path helpers in client route files**

Replace local pathname segment logic with:

```ts
import { projectBaseFromPathname } from '@/lib/project-url';

function useBasePath() {
  return projectBaseFromPathname(usePathname());
}
```

Apply to:

```text
src/app/p/[projectUuid]/pipelines/page.tsx
src/app/p/[projectUuid]/pipelines/[id]/page.tsx
```

- [ ] **Step 5: Search for stale slug assumptions**

Run:

```bash
rg -n "params\\.org|params\\.user|params\\.project|projectSlug|orgSlug|userSlug|getBySlug|/\\$\\{params\\.org\\}|/\\$\\{org\\}/\\$\\{user\\}/\\$\\{project\\}" src/app/p src/components src/lib
```

Expected: no old project-route slug assumptions remain in active `/p` code. Slug fields may still appear in non-route data display or legacy e2e skips.

- [ ] **Step 6: Commit** - `git add src/app/p src/components src/lib && git commit -m "feat(routing): build project navigation from UUID routes"`

## Task 6: Update Root Entrypoint And Delete Slug Routes

**Files:**
- Modify: `src/app/page.tsx`
- Delete: `src/app/[org]/**`

- [ ] **Step 1: Fix root redirect**

Replace the old `project.userId` query and slug redirect with a project UUID redirect:

```ts
const [proj] = await db.select().from(project).limit(1);
if (!proj) {
  return (
    <div className="flex items-center justify-center min-h-screen text-slate-400">
      <p>No project found. Run: npx tsx src/scripts/db/seed.ts</p>
    </div>
  );
}

redirect(`/p/${proj.id}`);
```

Remove unused `eq` and `user` imports from `src/app/page.tsx`.

- [ ] **Step 2: Delete the slug route tree**

Run:

```bash
rm -rf 'src/app/[org]'
```

Expected: `test ! -d 'src/app/[org]'`.

- [ ] **Step 3: Commit** - `git add src/app && git commit -m "feat(routing): route root entrypoints to project UUIDs"`

## Task 7: Add Focused Route Migration Proof

**Files:**
- Create: `e2e/flx-239-stage-4-routing.spec.ts`
- Modify: `e2e/helpers/setup.ts`

- [ ] **Step 1: Update the shared e2e helper to use project UUID**

Replace required slug env vars with `FLUXAOS_PROJECT_ID`:

```ts
const projectId = process.env.FLUXAOS_PROJECT_ID;

if (!projectId) {
  throw new Error(
    'e2e setup: missing required env var: FLUXAOS_PROJECT_ID. Set it in .env.local alongside DATABASE_URL.'
  );
}

const PROJECT_BASE = `/p/${projectId}`;
```

Do not rewrite all specs in Stage 4. This shared helper change will break old-path specs, which Stage 7 owns.

- [ ] **Step 2: Add the focused Stage 4 spec**

```ts
import { expect, projectPath, test } from './helpers/setup';

test.describe('@flx-239 @stage-4-routing', () => {
  test('root redirects to a project UUID route and project pages render', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/i);
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible({
      timeout: 15_000,
    });

    await page.goto(projectPath('/issues'));
    await expect(
      page.getByRole('heading', { name: /issues/i }).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test('old slug project route is not active', async ({ page }) => {
    await page.goto('/default/admin/fluxaos');
    await expect(page.getByText(/This page could not be found/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
```

- [ ] **Step 3: Run the focused journey**

Run:

```bash
set -a; source .env.local; set +a
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3004 npx playwright test e2e/flx-239-stage-4-routing.spec.ts
```

Expected: PASS after starting the dev server with `npm run dev -- -H 0.0.0.0 -p 3004`.

- [ ] **Step 4: Commit** - `git add e2e/flx-239-stage-4-routing.spec.ts e2e/helpers/setup.ts && git commit -m "test(e2e): prove project UUID routing"`

## Task 8: Final Verification And Handoff

**Files:**
- All changed files from Tasks 1-7.

- [ ] **Step 1: Run static checks**

Run:

```bash
npm run lint
npm run build
```

Expected:

- `npm run lint` passes.
- `npm run build` either passes or reports only known Stage 5-7 consumer debt already present on `main`. Any error in `src/app/p`, `src/lib/resolve-context.ts`, `src/lib/project-url.ts`, or `src/components/{nav,context-switcher}.tsx` is a Stage 4 failure to fix before handoff.

- [ ] **Step 2: Run focused route proof**

Run:

```bash
set -a; source .env.local; set +a
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3004 npx playwright test e2e/flx-239-stage-4-routing.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Search for active old project route files**

Run:

```bash
test ! -d 'src/app/[org]/[user]/[project]'
test ! -d 'src/app/[org]'
rg -n "params\\.org|params\\.user|params\\.project|getBySlug|projectSlug|orgSlug|userSlug" src/app/p src/components src/lib
```

Expected:

- The old slug route tree is absent.
- No active `/p` route code depends on project slugs for URL context.

- [ ] **Step 4: Push and open PR**

```bash
git status --short
git push -u origin flx-261-stage4-routing
gh pr create --fill
```

PR body must include:

- `Fixes FLX-261`
- Stage boundary statement: no Stage 5 router-scope migration, no Stage 6 waterfall consumers, no Stage 7 broad e2e rewrite.
- Verification commands and results.
