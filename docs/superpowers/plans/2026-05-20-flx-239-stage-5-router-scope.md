# FLX-239 Stage 5 Router Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move tRPC project authorization from owner-style checks to `project_member` / `team_member` access checks.

**Architecture:** Stage 4 already made project UUID the route context. Stage 5 keeps router surfaces stable where the UI already depends on them, but replaces authorization helpers and "current user's projects" queries with membership-aware logic. Feature-table waterfall read behavior stays out of scope for Stage 6.

**Tech Stack:** TypeScript, tRPC v11, Drizzle ORM, Supabase Postgres, Vitest integration tests.

---

## Router Audit

| File | Procedures | Stage 5 action |
|---|---|---|
| `src/server/routers/config.ts` | `list` | Replace `assertProjectOwnership` with `assertProjectAccess`; keep project config query unchanged. |
| `src/server/routers/issue.ts` | `list`, `getByNumber`, `getById`, `create`, `getChildren`, `hasOpenChildren`, `openChildCountsByProject`, `updateFields`, `transition`, `delete`, `transitions`, `comment.*` | Rename local `assertProjectViewership` to delegate to `assertProjectAccess`; keep `userId` mutation fields because they are audit actor fields, not authorization. |
| `src/server/routers/pipeline.ts` | `runs.*`, stage/run helpers, stage mutations | Replace every `assertProjectOwnership` call with `assertProjectAccess`; add access checks to project-scoped read procedures that currently lack them (`list`, `create`, `update`, `delete`, `stages.listByPipeline`, `stages.create/update/delete`) where project can be resolved. |
| `src/server/routers/project.ts` | `list`, `listByUser`, `create`, `update`, `delete`, `validateRepoUrl` | Make `list` and `listByUser` membership-aware. Keep `create` accepting `teamId` + `userId` for the settings form, but route through `createProjectService.create`. Add `project.addMember`, `project.removeMember`, `project.listMembers` only if needed by current UI/tests. |
| `src/server/routers/team.ts` | `listByProject`, `create`, `update`, `delete` | Add `assertProjectAccess` for `listByProject` and `create`; for `update/delete`, resolve team usage through `project.teamId` before asserting. Add `team.addMember`, `team.removeMember`, `team.listMembers` only if current settings UI needs them. |
| `src/server/routers/mission-control.ts` | `summary` | Add `assertProjectAccess` before project summary aggregation. |
| `src/server/routers/issue-catalog.ts` | all `projectId` list/create/update/deactivate/health procedures | Add `assertProjectAccess` before any project catalog read/write. Existing catalog services stay project-scoped. |
| `src/server/routers/cron.ts` | `listByProject`, `create`, `update`, `delete` | Add project access checks; resolve project from row for update/delete if input has only `id`. |
| `src/server/routers/brand.ts` | `listVisibleToProject`, project-scoped create/update | Add project access check when `projectId` is present. Org/catalog behavior remains Stage 6 work. |
| `src/server/routers/persona.ts` | project-scoped list/create/update/delete, skill attach/detach | Add project access check when a project can be resolved from `projectId` or the existing row. Leave waterfall resolution to Stage 6. |
| `src/server/routers/skill.ts` | project-scoped list/create/update/delete/history/revert | Add project access check when a project can be resolved from `projectId` or the existing row. Leave waterfall resolution to Stage 6. |
| `src/server/routers/provider.ts`, `routing.ts`, `driver.ts` | org/catalog settings | No project authorization change in Stage 5 unless a concrete `projectId` is present. Waterfall scoping is Stage 6. |
| `src/server/routers/organization.ts`, `user.ts` | org/user administration | Do not force project access. Keep user/org role gates; audit any user query that claims "my projects" through `project.ts`. |
| `src/server/routers/daemon.ts`, `gate.ts`, `pipeline-run-history.ts`, `_shared/enrich-stage-runs.ts` | daemon/system or helpers | No Stage 5 authorization change unless tests prove a project-scoped call path. |

## Files

- Modify: `src/server/ownership.ts` - replace owner helper with `assertProjectAccess`.
- Modify: `src/server/trpc.ts` - fail fast for missing authenticated fluxa user outside LAN bypass.
- Modify: `src/core/services/project.ts` - add membership list helpers used by `project.ts`.
- Modify: `src/server/routers/config.ts`, `issue.ts`, `pipeline.ts`, `project.ts`, `team.ts`, `mission-control.ts`, `issue-catalog.ts`, `cron.ts`, plus small project-aware checks in feature routers.
- Test: `src/__tests__/integration/project-access.test.ts` - new focused integration coverage for direct membership, team membership, forbidden access, not-found access, and LAN bypass.
- Test: existing integration fixtures under `src/__tests__/integration/` only as needed to seed `team_member` / `project_member`.

## Task 1: Test Project Access Semantics

**Files:**
- Create: `src/__tests__/integration/project-access.test.ts`

- [x] **Step 1: Write the failing access tests**

Create the test with this fixture shape:

```ts
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import type { Database } from '@/core/db/connection';
import * as schema from '@/core/db/schema';
import { assertProjectAccess } from '@/server/ownership';
import { deleteOrgFixture } from './cleanup-fixtures';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL required');

const provider = new SupabaseDatabaseProvider(url);
const db: Database = provider.getConnection();
const RUN = Date.now();

let orgId: string;
let directUserId: string;
let teamUserId: string;
let outsiderUserId: string;
let projectId: string;

beforeAll(async () => {
  const [org] = await db.insert(schema.organization).values({
    name: `access-org-${RUN}`,
    slug: `access-org-${RUN}`,
  }).returning();
  orgId = org.id;

  const [team] = await db.insert(schema.team).values({
    orgId,
    name: `access-team-${RUN}`,
  }).returning();

  const [directUser] = await db.insert(schema.user).values({
    orgId,
    email: `direct-${RUN}@test.local`,
    name: 'Direct User',
    slug: `direct-${RUN}`,
  }).returning();
  directUserId = directUser.id;

  const [teamUser] = await db.insert(schema.user).values({
    orgId,
    email: `team-${RUN}@test.local`,
    name: 'Team User',
    slug: `team-${RUN}`,
  }).returning();
  teamUserId = teamUser.id;

  const [outsider] = await db.insert(schema.user).values({
    orgId,
    email: `outsider-${RUN}@test.local`,
    name: 'Outsider',
    slug: `outsider-${RUN}`,
  }).returning();
  outsiderUserId = outsider.id;

  const [project] = await db.insert(schema.project).values({
    orgId,
    teamId: team.id,
    name: `access-project-${RUN}`,
    slug: `access-project-${RUN}`,
  }).returning();
  projectId = project.id;

  await db.insert(schema.projectMember).values({
    userId: directUserId,
    projectId,
  });
  await db.insert(schema.teamMember).values({
    userId: teamUserId,
    teamId: team.id,
  });
});

afterAll(async () => {
  if (orgId) await deleteOrgFixture(db, orgId);
  await provider.close();
});
```

Add tests:

```ts
it('allows direct project members', async () => {
  await expect(assertProjectAccess(db, projectId, directUserId)).resolves.toBeUndefined();
});

it('allows members of the project team', async () => {
  await expect(assertProjectAccess(db, projectId, teamUserId)).resolves.toBeUndefined();
});

it('rejects users without project or team membership', async () => {
  await expect(assertProjectAccess(db, projectId, outsiderUserId, {
    notOwnedCode: 'FORBIDDEN',
  })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('preserves LAN bypass when enabled', async () => {
  const prior = process.env.FLUXAOS_LAN_AUTH_BYPASS;
  process.env.FLUXAOS_LAN_AUTH_BYPASS = '1';
  try {
    await expect(assertProjectAccess(db, projectId, null)).resolves.toBeUndefined();
  } finally {
    if (prior === undefined) delete process.env.FLUXAOS_LAN_AUTH_BYPASS;
    else process.env.FLUXAOS_LAN_AUTH_BYPASS = prior;
  }
});
```

- [x] **Step 2: Run the test and verify it fails**

Run:

```bash
set -a; source .env.local; set +a
npx vitest run src/__tests__/integration/project-access.test.ts
```

Expected: compile/test failure because `assertProjectAccess` is not exported yet.

## Task 2: Implement `assertProjectAccess`

**Files:**
- Modify: `src/server/ownership.ts`
- Modify: `src/server/trpc.ts`

- [x] **Step 1: Replace owner logic with access logic**

In `src/server/ownership.ts`, import `teamMember` and select the project team:

```ts
import { and, eq, or } from 'drizzle-orm';
import { project, projectMember, teamMember } from '@/core/db/schema';
```

Export this helper and keep a compatibility alias until all routers are migrated:

```ts
export async function assertProjectAccess(
  db: Database,
  projectId: string,
  fluxaUserId: string | null,
  options: {
    notFoundMsg?: string;
    notOwnedCode?: OwnershipErrorCode;
    notOwnedMsg?: string;
  } = {}
): Promise<void> {
  const { notFoundMsg, notOwnedCode = 'NOT_FOUND', notOwnedMsg } = options;

  if (fluxaUserId === null && process.env.FLUXAOS_LAN_AUTH_BYPASS === '1') {
    return;
  }

  if (fluxaUserId === null) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authenticated user required.' });
  }

  const [proj] = await db
    .select({ id: project.id, teamId: project.teamId })
    .from(project)
    .where(eq(project.id, projectId));

  if (!proj) {
    throw new TRPCError({ code: 'NOT_FOUND', message: notFoundMsg });
  }

  const [membership] = await db
    .select({ projectId: project.id })
    .from(project)
    .leftJoin(projectMember, and(
      eq(projectMember.projectId, project.id),
      eq(projectMember.userId, fluxaUserId)
    ))
    .leftJoin(teamMember, and(
      eq(teamMember.teamId, project.teamId),
      eq(teamMember.userId, fluxaUserId)
    ))
    .where(and(
      eq(project.id, projectId),
      or(eq(projectMember.userId, fluxaUserId), eq(teamMember.userId, fluxaUserId))
    ));

  if (!membership) {
    throw new TRPCError({ code: notOwnedCode, message: notOwnedMsg });
  }
}

export const assertProjectOwnership = assertProjectAccess;
```

- [x] **Step 2: Make authenticated missing-user state explicit**

In `src/server/trpc.ts`, change the `if (!row)` branch in `resolveViewer`:

```ts
if (!row) {
  throw new TRPCError({
    code: 'UNAUTHORIZED',
    message: 'Authenticated user is not registered in fluxaOS.',
  });
}
```

Do not change the LAN-bypass branch at the top.

- [x] **Step 3: Verify the focused test passes**

Run:

```bash
set -a; source .env.local; set +a
npx vitest run src/__tests__/integration/project-access.test.ts
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/server/ownership.ts src/server/trpc.ts src/__tests__/integration/project-access.test.ts
git commit -m "feat(auth): add membership project access checks"
```

## Task 3: Migrate Existing Ownership Callers

**Files:**
- Modify: `src/server/routers/config.ts`
- Modify: `src/server/routers/issue.ts`
- Modify: `src/server/routers/pipeline.ts`

- [x] **Step 1: Replace imports and helper calls**

Change imports:

```ts
import { assertProjectAccess } from '../ownership';
```

Replace each `assertProjectOwnership(...)` call with `assertProjectAccess(...)`. Preserve every `notOwnedCode`, `notFoundMsg`, and `notOwnedMsg` option exactly.

- [x] **Step 2: Rename issue-local wrapper**

In `src/server/routers/issue.ts`, update the helper:

```ts
async function assertProjectViewership(
  db: Database,
  projectId: string,
  viewer: Viewer
) {
  await assertProjectAccess(db, projectId, viewer.fluxaUserId);
}
```

- [x] **Step 3: Run typecheck**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/server/routers/config.ts src/server/routers/issue.ts src/server/routers/pipeline.ts
git commit -m "refactor(auth): migrate project ownership callers"
```

## Task 4: Add Missing Project Access Checks

**Files:**
- Modify: `src/server/routers/mission-control.ts`
- Modify: `src/server/routers/issue-catalog.ts`
- Modify: `src/server/routers/cron.ts`
- Modify: `src/server/routers/project.ts`
- Modify: `src/server/routers/team.ts`

- [x] **Step 1: Guard project summary and issue catalogs**

At the top of project-scoped query handlers, add:

```ts
await assertProjectAccess(ctx.db, input.projectId, ctx.viewer.fluxaUserId, {
  notOwnedCode: 'FORBIDDEN',
  notOwnedMsg: 'You do not have access to this project.',
});
```

Use this in `mission.summary`, all issue-catalog `list` procedures, `transitions.create/delete`, and `health`.

- [x] **Step 2: Guard cron project reads and writes**

For `cron.listByProject` and `cron.create`, assert directly on `input.projectId`.

For `cron.update` and `cron.delete`, first load the row and assert its `projectId`:

```ts
const existing = await createCronService(ctx.db).getById(input.id);
if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: `Cron job not found: ${input.id}` });
await assertProjectAccess(ctx.db, existing.projectId, ctx.viewer.fluxaUserId, {
  notOwnedCode: 'FORBIDDEN',
});
```

- [x] **Step 3: Make project listing membership-aware**

In `src/core/services/project.ts`, add:

```ts
async listAccessibleByUser(userId: string): Promise<ProjectSelect[]> {
  const rows = await db
    .select({ project })
    .from(project)
    .leftJoin(projectMember, eq(projectMember.projectId, project.id))
    .leftJoin(teamMember, eq(teamMember.teamId, project.teamId))
    .where(or(eq(projectMember.userId, userId), eq(teamMember.userId, userId)));
  const byId = new Map(rows.map((row) => [row.project.id, row.project]));
  return [...byId.values()];
}
```

Import `or` and `teamMember`. Use this from `project.list` when `ctx.viewer.fluxaUserId` is non-null. Preserve LAN bypass with an explicit `if (ctx.viewer.fluxaUserId === null && process.env.FLUXAOS_LAN_AUTH_BYPASS === '1')` branch that returns all projects for dev/Playwright only; outside that branch, throw `UNAUTHORIZED`.

- [x] **Step 4: Guard team router project access**

Use `assertProjectAccess` in `team.listByProject` and `team.create`.

For `team.update/delete`, resolve projects using that `team.id` through `project.teamId`. If no project references the team, treat it as org-admin-only and leave role gate as the guard for this stage.

- [x] **Step 5: Commit**

```bash
git add src/core/services/project.ts src/server/routers/mission-control.ts src/server/routers/issue-catalog.ts src/server/routers/cron.ts src/server/routers/project.ts src/server/routers/team.ts
git commit -m "feat(auth): guard project-scoped router reads"
```

## Task 5: Feature Router Minimal Guards

**Files:**
- Modify: `src/server/routers/brand.ts`
- Modify: `src/server/routers/persona.ts`
- Modify: `src/server/routers/skill.ts`

- [x] **Step 1: Guard direct project inputs**

When an input includes `projectId`, assert access before reading or writing:

```ts
if (input.projectId) {
  await assertProjectAccess(ctx.db, input.projectId, ctx.viewer.fluxaUserId, {
    notOwnedCode: 'FORBIDDEN',
  });
}
```

- [x] **Step 2: Guard row-derived project IDs**

For update/delete/history procedures where the input has only `id`, load the row first. If the row has a non-null `projectId`, assert access before mutation. If `projectId` is null/catalog, leave existing role gate only; Stage 6 owns waterfall semantics.

- [x] **Step 3: Commit**

```bash
git add src/server/routers/brand.ts src/server/routers/persona.ts src/server/routers/skill.ts
git commit -m "feat(auth): guard project-scoped feature rows"
```

## Task 6: Verification

**Files:**
- Modify tests only if a fixture fails because it lacks `project_member` or `team_member`.

- [x] **Step 1: Run focused tests**

```bash
set -a; source .env.local; set +a
npx vitest run src/__tests__/integration/project-access.test.ts
npx vitest run src/__tests__/integration/project-settings.test.ts
npx vitest run src/__tests__/integration/issue-comment.test.ts
```

Expected: all selected tests pass.

- [x] **Step 2: Run full static verification**

```bash
npx biome check .
npx tsc --noEmit --pretty false
npm run lint
npm run build
```

Expected: all pass; ESLint may report existing warnings only.

- [x] **Step 3: Run full router integration gate**

```bash
set -a; source .env.local; set +a
npx vitest run src/__tests__/integration/
```

Expected: green, except pre-existing unrelated failures must be documented with exact test names and current failure text. Do not hide a new authorization failure under that exception.

Result: `npx vitest run src/__tests__/integration/` was not green in the current shared database state: 19 files failed, 33 passed; 35 tests failed, 331 passed, 6 skipped. Failures were not new Stage 5 authorization denials. The visible failure buckets were Stage 6 waterfall fixture constraints (`provider_scope_check`, `brand_scope_check`, `skill_scope_check`), the known `services.test.ts` duplicate catalog key expectation, local runtime cleanup/workspace/artifact config state, teardown timeouts, one `brand-service.test.ts` teardown FK cleanup issue, and one `skill-crud.test.ts` missing references expectation.

- [x] **Step 4: Commit any fixture-only repairs**

```bash
git add src/__tests__/integration
git commit -m "test(auth): seed memberships for router tests"
```

Result: no fixture-only repairs were needed for Stage 5 authorization coverage.

## Self-Review Notes

- Spec coverage: `assertProjectAccess`, LAN bypass, router audit, membership-aware project listing, and integration coverage are mapped above.
- Stage boundary: this plan does not migrate feature-table waterfall reads; that remains Stage 6.
- Known risk: `src/__tests__/integration/services.test.ts` currently has an unrelated duplicate catalog key expectation failure observed during Stage 4 verification. If it remains, document it exactly rather than broadening Stage 5.
