# FLX-8 Agent-Output Brand Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the agent-output brand service so operators can manage brand records, attach them to personas/projects, and have stage runs materialize the resolved brand tone/style into worker instructions.

**Architecture:** Use the existing `brand`, `persona.brandId`, and `project.brandId` schema. Add a DI brand service and tRPC router, then wire Settings UI and stage-runner runtime resolution with persona-over-project precedence.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, tRPC v11, Drizzle ORM, Supabase Postgres, Vitest integration tests, Playwright journey tests.

---

## File Map

- Create `src/core/services/brand.ts`: brand service with CRUD plus org/project list helpers.
- Modify `src/core/services/index.ts`: export `createBrandService`.
- Create `src/server/routers/brand.ts`: tRPC brand API.
- Modify `src/server/root.ts`: register `brandRouter`.
- Create `src/core/orchestrator/brand-resolver.ts`: runtime precedence helper.
- Modify `src/core/orchestrator/stage-runner.ts`: use project fallback brand before materialization.
- Create `src/app/[org]/[user]/[project]/settings/brands/page.tsx`: Settings Brands UI.
- Modify `src/app/[org]/[user]/[project]/settings/layout.tsx`: add Brands tab.
- Modify `src/app/[org]/[user]/[project]/settings/personas/page.tsx`: add brand selector.
- Modify `src/app/[org]/[user]/[project]/settings/projects/page.tsx`: add default brand selector.
- Create `src/__tests__/integration/brand-service.test.ts`: service/router/runtime integration coverage.
- Create `e2e/flx-8-brand-service.spec.ts`: operator journey.

## Task 1: Brand Service and Router

**Files:**
- Create: `src/core/services/brand.ts`
- Modify: `src/core/services/index.ts`
- Create: `src/server/routers/brand.ts`
- Modify: `src/server/root.ts`
- Test: `src/__tests__/integration/brand-service.test.ts`

- [ ] **Step 1: Write the failing service test**

Add `src/__tests__/integration/brand-service.test.ts` with the first test:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/core/db/connection';
import { brand, organization, project, user } from '@/core/db/schema';
import { createBrandService } from '@/core/services';
import { appRouter } from '@/server/root';

const RUN = Date.now().toString(36);
const cleanup: { table: 'brand' | 'project' | 'user' | 'organization'; id: string }[] = [];

async function seedOrgUserProject() {
  const [org] = await db
    .insert(organization)
    .values({ name: `brand-org-${RUN}`, slug: `brand-org-${RUN}` })
    .returning();
  cleanup.push({ table: 'organization', id: org.id });

  const [usr] = await db
    .insert(user)
    .values({
      orgId: org.id,
      email: `brand-${RUN}@example.com`,
      name: `Brand User ${RUN}`,
      slug: `brand-user-${RUN}`,
    })
    .returning();
  cleanup.push({ table: 'user', id: usr.id });

  const [proj] = await db
    .insert(project)
    .values({
      orgId: org.id,
      userId: usr.id,
      name: `Brand Project ${RUN}`,
      slug: `brand-project-${RUN}`,
    })
    .returning();
  cleanup.push({ table: 'project', id: proj.id });

  return { org, usr, proj };
}

afterAll(async () => {
  for (const item of cleanup.reverse()) {
    if (item.table === 'brand') await db.delete(brand).where(eq(brand.id, item.id));
    if (item.table === 'project') await db.delete(project).where(eq(project.id, item.id));
    if (item.table === 'user') await db.delete(user).where(eq(user.id, item.id));
    if (item.table === 'organization') await db.delete(organization).where(eq(organization.id, item.id));
  }
});

describe('brand service', () => {
  it('lists org brands and project-visible brands', async () => {
    const { org, proj } = await seedOrgUserProject();
    const svc = createBrandService(db);

    const orgBrand = await svc.create({
      orgId: org.id,
      name: `Org Brand ${RUN}`,
      toneOfVoice: 'Direct and concrete',
      styleGuide: 'Use short paragraphs.',
    });
    cleanup.push({ table: 'brand', id: orgBrand.id });

    const projectBrand = await svc.create({
      orgId: org.id,
      projectId: proj.id,
      name: `Project Brand ${RUN}`,
      toneOfVoice: 'Operational and precise',
      styleGuide: 'Lead with outcomes.',
    });
    cleanup.push({ table: 'brand', id: projectBrand.id });

    const byOrg = await svc.listByOrg(org.id);
    expect(byOrg.map((row) => row.id)).toEqual(
      expect.arrayContaining([orgBrand.id, projectBrand.id])
    );

    const visible = await svc.listVisibleToProject(org.id, proj.id);
    expect(visible.map((row) => row.id)).toEqual(
      expect.arrayContaining([orgBrand.id, projectBrand.id])
    );
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
npx vitest run src/__tests__/integration/brand-service.test.ts
```

Expected: FAIL with an import error for `createBrandService`.

- [ ] **Step 3: Implement the service**

Create `src/core/services/brand.ts`:

```ts
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { brand } from '@/core/db/schema';
import { createCrudService } from './crud-factory';

type BrandInsert = typeof brand.$inferInsert;
type BrandSelect = typeof brand.$inferSelect;

export function createBrandService(db: Database) {
  const crud = createCrudService<BrandInsert, BrandSelect>(db, brand);

  return {
    ...crud,

    async listByOrg(orgId: string): Promise<BrandSelect[]> {
      return db
        .select()
        .from(brand)
        .where(eq(brand.orgId, orgId))
        .orderBy(desc(brand.createdAt));
    },

    async listByProject(projectId: string): Promise<BrandSelect[]> {
      return db
        .select()
        .from(brand)
        .where(eq(brand.projectId, projectId))
        .orderBy(desc(brand.createdAt));
    },

    async listVisibleToProject(
      orgId: string,
      projectId: string
    ): Promise<BrandSelect[]> {
      return db
        .select()
        .from(brand)
        .where(
          and(
            eq(brand.orgId, orgId),
            or(isNull(brand.projectId), eq(brand.projectId, projectId))
          )
        )
        .orderBy(desc(brand.createdAt));
    },
  };
}

export type BrandService = ReturnType<typeof createBrandService>;
```

Modify `src/core/services/index.ts`:

```ts
export { createBrandService, type BrandService } from './brand';
```

- [ ] **Step 4: Run the service test**

Run:

```bash
npx vitest run src/__tests__/integration/brand-service.test.ts
```

Expected: PASS for the service test.

- [ ] **Step 5: Add the router**

Create `src/server/routers/brand.ts`:

```ts
import { z } from 'zod/v4';
import { createBrandService } from '@/core/services';
import { publicProcedure, router } from '../trpc';

const jsonObject = z.record(z.string(), z.unknown());

export const brandRouter = router({
  listByOrg: publicProcedure
    .input(z.object({ orgId: z.string().uuid() }))
    .query(({ ctx, input }) => createBrandService(ctx.db).listByOrg(input.orgId)),

  listVisibleToProject: publicProcedure
    .input(z.object({ orgId: z.string().uuid(), projectId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      createBrandService(ctx.db).listVisibleToProject(input.orgId, input.projectId)
    ),

  getById: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => createBrandService(ctx.db).getById(input.id)),

  create: publicProcedure
    .input(
      z.object({
        orgId: z.string().uuid(),
        projectId: z.string().uuid().nullable().optional(),
        name: z.string().min(1),
        colors: jsonObject.nullable().optional(),
        fonts: jsonObject.nullable().optional(),
        toneOfVoice: z.string().nullable().optional(),
        styleGuide: z.string().nullable().optional(),
        logoUrl: z.string().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => createBrandService(ctx.db).create(input)),

  update: publicProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        projectId: z.string().uuid().nullable().optional(),
        name: z.string().min(1).optional(),
        colors: jsonObject.nullable().optional(),
        fonts: jsonObject.nullable().optional(),
        toneOfVoice: z.string().nullable().optional(),
        styleGuide: z.string().nullable().optional(),
        logoUrl: z.string().nullable().optional(),
      })
    )
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return createBrandService(ctx.db).update(id, data);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => createBrandService(ctx.db).remove(input.id)),
});
```

Modify `src/server/root.ts`:

```ts
import { brandRouter } from './routers/brand';

export const appRouter = router({
  brand: brandRouter,
});
```

Keep all existing router entries in `appRouter`; add `brand` without removing anything.

- [ ] **Step 6: Add router CRUD coverage**

Append to `src/__tests__/integration/brand-service.test.ts`:

```ts
describe('brand router', () => {
  it('creates, updates, lists, and deletes a brand through tRPC', async () => {
    const { org, proj } = await seedOrgUserProject();
    const caller = appRouter.createCaller({
      db,
      viewer: {
        authUserId: null,
        fluxaUserId: null,
        role: 'admin',
        tier: 'enterprise',
      },
    });

    const created = await caller.brand.create({
      orgId: org.id,
      projectId: proj.id,
      name: `Router Brand ${RUN}`,
      toneOfVoice: 'Router tone',
      styleGuide: 'Router style',
      colors: { primary: '#5B21B6' },
      fonts: { sans: 'Inter' },
      logoUrl: null,
    });
    cleanup.push({ table: 'brand', id: created.id });

    const updated = await caller.brand.update({
      id: created.id,
      name: `Router Brand Updated ${RUN}`,
      toneOfVoice: 'Updated router tone',
      styleGuide: 'Updated router style',
    });

    expect(updated?.name).toBe(`Router Brand Updated ${RUN}`);
    expect(updated?.toneOfVoice).toBe('Updated router tone');

    const visible = await caller.brand.listVisibleToProject({
      orgId: org.id,
      projectId: proj.id,
    });
    expect(visible.map((row) => row.id)).toContain(created.id);

    const deleted = await caller.brand.delete({ id: created.id });
    expect(deleted).toBe(true);
    cleanup.splice(
      cleanup.findIndex((item) => item.table === 'brand' && item.id === created.id),
      1
    );
  });
});
```

- [ ] **Step 7: Commit Task 1**

Run:

```bash
npx biome check --write src/core/services/brand.ts src/core/services/index.ts src/server/routers/brand.ts src/server/root.ts src/__tests__/integration/brand-service.test.ts
npx vitest run src/__tests__/integration/brand-service.test.ts
git add src/core/services/brand.ts src/core/services/index.ts src/server/routers/brand.ts src/server/root.ts src/__tests__/integration/brand-service.test.ts
git commit -m "feat(brand): add service and tRPC router" -m "Refs FLX-8"
```

Expected: Biome exits 0, Vitest exits 0, commit succeeds.

## Task 2: Runtime Brand Resolution

**Files:**
- Create: `src/core/orchestrator/brand-resolver.ts`
- Modify: `src/core/orchestrator/stage-runner.ts`
- Test: `src/__tests__/integration/brand-service.test.ts`

- [ ] **Step 1: Add resolver tests**

Append to `src/__tests__/integration/brand-service.test.ts`:

```ts
import { resolveStageBrand } from '@/core/orchestrator/brand-resolver';

describe('stage brand resolver', () => {
  it('prefers persona brand over project brand', async () => {
    const { org, proj } = await seedOrgUserProject();
    const svc = createBrandService(db);
    const projectBrand = await svc.create({
      orgId: org.id,
      projectId: proj.id,
      name: `Project Runtime Brand ${RUN}`,
      toneOfVoice: 'Project tone',
    });
    cleanup.push({ table: 'brand', id: projectBrand.id });
    const personaBrand = await svc.create({
      orgId: org.id,
      name: `Persona Runtime Brand ${RUN}`,
      toneOfVoice: 'Persona tone',
    });
    cleanup.push({ table: 'brand', id: personaBrand.id });

    const resolved = await resolveStageBrand(db, {
      personaBrandId: personaBrand.id,
      projectBrandId: projectBrand.id,
    });

    expect(resolved?.id).toBe(personaBrand.id);
    expect(resolved?.toneOfVoice).toBe('Persona tone');
  });

  it('uses project brand when persona brand is not set', async () => {
    const { org, proj } = await seedOrgUserProject();
    const svc = createBrandService(db);
    const projectBrand = await svc.create({
      orgId: org.id,
      projectId: proj.id,
      name: `Fallback Runtime Brand ${RUN}`,
      toneOfVoice: 'Project fallback tone',
    });
    cleanup.push({ table: 'brand', id: projectBrand.id });

    const resolved = await resolveStageBrand(db, {
      personaBrandId: null,
      projectBrandId: projectBrand.id,
    });

    expect(resolved?.id).toBe(projectBrand.id);
  });

  it('returns null when no brand is configured', async () => {
    const resolved = await resolveStageBrand(db, {
      personaBrandId: null,
      projectBrandId: null,
    });

    expect(resolved).toBeNull();
  });
});
```

- [ ] **Step 2: Run the failing resolver tests**

Run:

```bash
npx vitest run src/__tests__/integration/brand-service.test.ts
```

Expected: FAIL with an import error for `brand-resolver`.

- [ ] **Step 3: Implement the resolver**

Create `src/core/orchestrator/brand-resolver.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Database } from '@/core/db/connection';
import { brand } from '@/core/db/schema';

type BrandSelect = typeof brand.$inferSelect;

async function findBrand(
  db: Database,
  brandId: string | null | undefined
): Promise<BrandSelect | null> {
  if (!brandId) return null;
  const [row] = await db.select().from(brand).where(eq(brand.id, brandId));
  return row ?? null;
}

export async function resolveStageBrand(
  db: Database,
  input: {
    personaBrandId: string | null | undefined;
    projectBrandId: string | null | undefined;
  }
): Promise<BrandSelect | null> {
  const personaBrand = await findBrand(db, input.personaBrandId);
  if (personaBrand) return personaBrand;
  return findBrand(db, input.projectBrandId);
}
```

- [ ] **Step 4: Wire the stage runner**

Modify `src/core/orchestrator/stage-runner.ts`:

1. Remove `brand` from the schema import if it is only used for persona extension typing.
2. Import the resolver:

```ts
import { resolveStageBrand } from './brand-resolver';
```

3. Change the persona type extension from `brandEntry` to resolved brand values or keep the type narrow with `typeof brand.$inferSelect` if still imported.
4. After `acquireIsolationEnv(...)`, use the returned project row:

```ts
  const { env, projectRow } = await acquireIsolationEnv({
    db,
    isolation,
    projectId,
    runId,
    pipelineId: run.pipelineId,
    issueId: run.issueId ?? null,
    issueNumber: issueRow?.number ?? null,
  });

  const resolvedBrand = await resolveStageBrand(db, {
    personaBrandId: personaRow?.brandId ?? null,
    projectBrandId: projectRow.brandId,
  });
```

5. Change the materializer persona input:

```ts
    persona: personaRow
      ? {
          soul: personaRow.soul,
          identity: personaRow.identity,
          brandToneOfVoice: resolvedBrand?.toneOfVoice,
          brandStyleGuide: resolvedBrand?.styleGuide,
        }
      : resolvedBrand
        ? {
            soul: null,
            identity: null,
            brandToneOfVoice: resolvedBrand.toneOfVoice,
            brandStyleGuide: resolvedBrand.styleGuide,
          }
        : null,
```

This allows project brand context even when a stage has no persona.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
npx biome check --write src/core/orchestrator/brand-resolver.ts src/core/orchestrator/stage-runner.ts src/__tests__/integration/brand-service.test.ts
npx vitest run src/__tests__/integration/brand-service.test.ts
git add src/core/orchestrator/brand-resolver.ts src/core/orchestrator/stage-runner.ts src/__tests__/integration/brand-service.test.ts
git commit -m "feat(orchestrator): resolve runtime brand context" -m "Refs FLX-8"
```

Expected: Biome exits 0, Vitest exits 0, commit succeeds.

## Task 3: Settings Brands UI

**Files:**
- Create: `src/app/[org]/[user]/[project]/settings/brands/page.tsx`
- Modify: `src/app/[org]/[user]/[project]/settings/layout.tsx`
- Test: `e2e/flx-8-brand-service.spec.ts`

- [ ] **Step 1: Create the Brands page**

Create `src/app/[org]/[user]/[project]/settings/brands/page.tsx` as a client component. Match the existing Settings page style and use `trpc.organization.list`, `trpc.project.listByOrg`, and `trpc.brand.listVisibleToProject`.

The create form should submit:

```ts
createBrand.mutate({
  orgId,
  projectId: scope === 'project' ? projectId : null,
  name: name.trim(),
  toneOfVoice: toneOfVoice.trim() || null,
  styleGuide: styleGuide.trim() || null,
  colors: parseJsonObject(colors),
  fonts: parseJsonObject(fonts),
  logoUrl: logoUrl.trim() || null,
});
```

Use this JSON helper in the page:

```ts
function parseJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object.');
  }
  return parsed as Record<string, unknown>;
}
```

On parse errors, render `Expected a JSON object.` near the field and do not submit.

- [ ] **Step 2: Add the Settings tab**

Modify `src/app/[org]/[user]/[project]/settings/layout.tsx` and add:

```ts
{ label: 'Brands', href: `${base}/brands` }
```

Place it near Personas because brands affect persona runtime context.

- [ ] **Step 3: Add Playwright scaffold**

Create `e2e/flx-8-brand-service.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

const base = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3003';

test('operator can create a brand', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto(`${base}/rebos/joseph/fluxaos/settings/brands`);
  await page.getByRole('button', { name: /new brand/i }).click();
  await page.getByLabel(/brand name/i).fill('FLX-8 Runtime Brand');
  await page.getByLabel(/tone of voice/i).fill('Direct, concrete, operator-focused.');
  await page.getByLabel(/style guide/i).fill('Lead with outcomes. Avoid invented numbers.');
  await page.getByRole('button', { name: /^create$/i }).click();

  await expect(page.getByText('FLX-8 Runtime Brand')).toBeVisible();
  await page.reload();
  await expect(page.getByText('FLX-8 Runtime Brand')).toBeVisible();

  expect(errors).toEqual([]);
});
```

Adjust the seeded URL only if `npm run db:seed` creates different slugs in this checkout.

- [ ] **Step 4: Commit Task 3**

Run:

```bash
npx biome check --write 'src/app/[org]/[user]/[project]/settings/brands/page.tsx' 'src/app/[org]/[user]/[project]/settings/layout.tsx' e2e/flx-8-brand-service.spec.ts
git add 'src/app/[org]/[user]/[project]/settings/brands/page.tsx' 'src/app/[org]/[user]/[project]/settings/layout.tsx' e2e/flx-8-brand-service.spec.ts
git commit -m "feat(settings): add brand management surface" -m "Refs FLX-8"
```

Expected: Biome exits 0, commit succeeds.

## Task 4: Persona and Project Brand Attachment

**Files:**
- Modify: `src/app/[org]/[user]/[project]/settings/personas/page.tsx`
- Modify: `src/app/[org]/[user]/[project]/settings/projects/page.tsx`
- Modify: `src/server/routers/project.ts`
- Test: `e2e/flx-8-brand-service.spec.ts`

- [ ] **Step 1: Extend project router update input**

Modify `src/server/routers/project.ts` so `update` accepts:

```ts
brandId: z.string().uuid().nullable().optional(),
```

Pass it through to `createProjectService(ctx.db).update(...)` with the other update fields.

- [ ] **Step 2: Add persona brand selector**

In `src/app/[org]/[user]/[project]/settings/personas/page.tsx`:

- include `brandId: string | null` in the `Persona` type;
- query visible brands for the current project;
- render a select in create and edit forms;
- submit `brandId: selectedBrandId || undefined` on create and `brandId: selectedBrandId || null` on update.

The select should include:

```tsx
<option value="">No brand</option>
{brands.map((brand) => (
  <option key={brand.id} value={brand.id}>
    {brand.name}
  </option>
))}
```

- [ ] **Step 3: Add project default brand selector**

In `src/app/[org]/[user]/[project]/settings/projects/page.tsx`, render a `select` for each project with the same options. On change:

```ts
updateProject.mutate({
  id: project.id,
  brandId: value || null,
});
```

Invalidate `project.list` and `brand.listVisibleToProject` after success.

- [ ] **Step 4: Extend the Playwright journey**

Extend `e2e/flx-8-brand-service.spec.ts`:

```ts
await page.goto(`${base}/rebos/joseph/fluxaos/settings/personas`);
await page.getByRole('button', { name: /^edit$/i }).first().click();
await page.getByLabel(/brand/i).selectOption({ label: 'FLX-8 Runtime Brand' });
await page.getByRole('button', { name: /^save$/i }).click();

await page.goto(`${base}/rebos/joseph/fluxaos/settings/projects`);
await page.getByLabel(/default brand/i).first().selectOption({ label: 'FLX-8 Runtime Brand' });
await page.reload();
await expect(page.getByLabel(/default brand/i).first()).toHaveValue(/.+/);
```

If multiple Edit buttons exist and the selector is ambiguous, add `aria-label={`Edit ${p.name}`}` to the persona edit button and select by that label.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
npx biome check --write 'src/app/[org]/[user]/[project]/settings/personas/page.tsx' 'src/app/[org]/[user]/[project]/settings/projects/page.tsx' src/server/routers/project.ts e2e/flx-8-brand-service.spec.ts
git add 'src/app/[org]/[user]/[project]/settings/personas/page.tsx' 'src/app/[org]/[user]/[project]/settings/projects/page.tsx' src/server/routers/project.ts e2e/flx-8-brand-service.spec.ts
git commit -m "feat(settings): attach brands to personas and projects" -m "Refs FLX-8"
```

Expected: Biome exits 0, commit succeeds.

## Task 5: Full Verification

**Files:**
- Verify all changed files.
- Update docs only if implementation discovers a real mismatch.

- [ ] **Step 1: Run format/check**

Run:

```bash
npx biome check --write
npm run lint
```

Expected: both commands exit 0.

- [ ] **Step 2: Run integration tests**

Run:

```bash
npx vitest run src/__tests__/integration/brand-service.test.ts
npx vitest run
```

Expected: both commands exit 0.

- [ ] **Step 3: Run the Playwright journey**

Ensure the dev server is running on port 3003. If it is not running:

```bash
npm run dev -- -p 3003
```

Then run:

```bash
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/flx-8-brand-service.spec.ts
```

Expected: the FLX-8 journey exits 0 with no page errors or console errors captured by the test.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: build exits 0.

- [ ] **Step 5: Update Linear and prepare PR**

Run:

```bash
git status --short
```

Expected: clean working tree after all commits.

Then update Linear FLX-8 with the PR link and move it to `In Review`. PR body should include:

```md
## Summary
- adds brand service/router and Settings brand management
- wires persona/project brand attachment
- resolves runtime brand context with persona-over-project precedence

## Verification
- npx biome check --write
- npm run lint
- npx vitest run
- PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/flx-8-brand-service.spec.ts
- npm run build

Refs FLX-8
```
