# FLX-239 — Tenancy + Waterfall Config Epic Plan

> **For agentic workers:** This is the EPIC plan. Each of the 8 stages becomes its own slice plan written just-in-time at `docs/superpowers/plans/YYYY-MM-DD-flx-239-stage-N-<slug>.md`. Each stage plan is a normal single-PR plan using `superpowers:writing-plans`. Do not start stage N+1 before stage N's PR has merged into main and the verification gate is green.

**Goal:** Replace the current tenancy model with `customer → organization → team → user → project`, with M:N user↔team and user↔project, UUID-only URLs, and uniform Kopia-style waterfall inheritance for every feature row.

**Architecture:**

- **Tenancy hierarchy:** customer (placeholder) → organization → team → user → project. M:N user↔team via `team_member`; M:N user↔project via `project_member`; project belongs to one team for default team-wide access.
- **URLs:** UUID-only, single-letter route prefixes (`/p/{uuid}/...`, `/i/{uuid}`, `/r/{uuid}`). No slugs anywhere. Display names free-text.
- **Waterfall config:** every feature row gets four nullable scope columns (`org_id`, `team_id`, `user_id`, `project_id`) + `kind` discriminator + CHECK constraint (exactly one scope FK non-null, or all null for catalog). Read resolution walks project → user → team → org → catalog; first hit wins. Implemented once via shared `resolveScoped<T>()` helper.

**Tech Stack:** TypeScript, Drizzle ORM, Postgres (Supabase Cloud), Next.js 16 App Router, tRPC v11, Playwright E2E.

**Spec:** [`docs/superpowers/specs/2026-05-18-tenancy-waterfall-design.md`](../specs/2026-05-18-tenancy-waterfall-design.md)

**Linear:** [FLX-239](https://linear.app/rebos/issue/FLX-239)

**Constraints (project-wide):**

- No fallbacks ever — fail fast.
- No unit tests; integration tests against real Supabase only.
- UI-touching PRs require a new or extended Playwright journey test in the same PR.
- Rip-and-replace migration: no backwards compatibility, no backfill scripts; nuke + reseed against new schema. (No production, no users — see CLAUDE.md environment override.)

---

## Stage map at a glance

| # | Stage | Touches | Verification gate |
|---|---|---|---|
| 1 | Schema migration | `schema.ts`, all `drizzle/*.sql`, `nuke.ts` | `npm run db:migrate` clean; `npm run db:generate` produces no drift |
| 2 | Seed rewrite | `scripts/db/seed.ts`, `tests/verify/*` | `npm run db:seed && npm run verify:seed` |
| 3 | Waterfall helper | `src/core/services/resolve-scoped.ts` (new), integration tests | `npx vitest src/__tests__/integration/resolve-scoped.test.ts` |
| 4 | Routing migration | `src/app/p/[projectUuid]/**` (new), `src/lib/resolve-context.ts` | dev server boots; old route paths 404; new route paths render |
| 5 | Router scope migration | `src/server/routers/*.ts`, `assertProjectAccess` helper | every router test green; tRPC e2e contract unchanged where the surface is preserved |
| 6 | Feature-table consumers | every place that reads a feature row (pipelines, personas, brands, etc.) | journey tests still green; `resolveScoped` covers all read paths |
| 7 | E2E spec updates | `e2e/helpers/setup.ts` + ~47 specs (most via the central helper) | full Playwright suite green; full-issue-lifecycle passes |
| 8 | Cleanup | delete old `[org]/[user]/[project]/**`, old helpers, old slug columns | grep finds zero refs to dead paths; final `npm run verify` clean |

Stages 1→2→3 are hard sequential. Stage 4 depends on 3. Stage 5 depends on 4 (resolveContext shape). Stage 6 depends on 3 (helper exists). Stages 6 and 5 can overlap if carefully sliced. Stage 7 depends on 4+5. Stage 8 last.

---

## Stage 1 — Schema migration

**Spec sections satisfied:** "Hierarchy", "Customer placeholder", "Schema changes" (deleted/added/modified tables), "Waterfall schema columns".

**Files affected:**

- `src/core/db/schema.ts` — biggest single file in the change.
- `drizzle/*.sql` — new numbered migration files for each schema change (Drizzle generates).
- `drizzle/meta/_journal.json` — Drizzle journal updated by codegen.
- `src/scripts/db/nuke.ts` — extended to drop the new tables alongside the old.

**Concrete schema work, broken down:**

*Tenancy tables:*
- Add `customer` table (`id, external_billing_id text, created_at, updated_at`).
- Add `organization.customer_id uuid` (nullable, no FK).
- DROP existing `team` and `team_member` tables (project_id + persona_id model).
- Add new `team` table (`id, org_id NOT NULL, name, description, version, created_at, updated_at`).
- Add new `team_member` table (`user_id, team_id, role`, PK `(user_id, team_id)`).
- Add new `project_member` table (`user_id, project_id, role`, PK `(user_id, project_id)`).
- Add `project.team_id NOT NULL` (FK to `team.id`).
- DROP `project.user_id` FK column.
- Add `BEFORE INSERT OR UPDATE ON project` trigger that overwrites `project.org_id` from `team.org_id` (enforces the denormalization invariant per spec; Postgres CHECK can't cross rows).
- **Slug columns are NOT dropped in Stage 1.** All slug column drops (`organization.slug`, `user.slug`, `project.slug`, and any URL-bearing entity slug) are deferred to Stage 8 because the Stage 4 redirect scaffold needs them to translate old URLs to UUIDs. Listed here for tracking only; do not include any `DROP COLUMN slug` in Stage 1's migration SQL.

*Feature tables (waterfall additions):*

Add four nullable scope columns (`org_id`, `team_id`, `user_id`, `project_id`) + `kind` text discriminator + CHECK constraint to:
- `persona`, `skill`, `provider`, `driver`, `brand`, `routingProfile`.

`model` and `routingRule` are NOT added to the waterfall (they inherit via their parent provider/routingProfile FK — see spec). Don't touch their schema in Stage 1.

`gateConfig` is mentioned in some product discussions but no `gate_config` table exists in the current schema. Do not speculatively add one in Stage 1.

For each waterfall feature table that today has `orgId NOT NULL`, **drop the NOT NULL**:
- `provider.org_id` — drop NOT NULL.
- `routingProfile.org_id` — drop NOT NULL.
- `brand.org_id` — drop NOT NULL.

**Pre-existing column collisions** (must be dropped BEFORE adding the new waterfall columns or the migration fails with `column already exists`):
- `persona.scope text NOT NULL default 'project'` — DROP.
- `persona.project_id uuid REFERENCES project(id)` — DROP.
- `skill.scope text NOT NULL default 'project'` — DROP.
- `skill.project_id uuid REFERENCES project(id)` — DROP.
- `brand.project_id uuid` — DROP (vestigial, never wired into `brandRelations`).

The `skill_revision` table also has `scope text NOT NULL`. It's an append-only history table, not in the waterfall; its `scope` column captured the old discriminator value at revision time. Stage 1 leaves it intact (rip-and-replace authorized — historical revisions become semantically stale, which is acceptable).

CHECK constraint logic per feature table: `(num_non_null(org_id, team_id, user_id, project_id) = 1 AND kind = matching_layer) OR (num_non_null(...) = 0 AND kind = 'catalog')`.

**Drizzle relations:** `personaRelations` and `skillRelations` reference the dropped `.projectId` columns today and MUST be updated in the same Stage 1 PR. Without this, `npm run build` fails at compile time. `brandRelations` currently does NOT reference `projectId` so requires no edit, but verify at slice-plan time. This is why Stage 1's scope explicitly includes `schema.ts` relation edits, not just table edits.

**Index sequencing for dropped columns:**
- `project_user_slug_idx` (`UNIQUE (user_id, slug)` on project) references the dropped `project.user_id`. DROP this index in the migration BEFORE the column drop, or use `CASCADE` — Drizzle's codegen does not emit `CASCADE` by default, so the migration SQL must explicitly drop the index first. Verified at slice-plan time by running the generated migration on a fresh DB.

**Unique-index repair after `orgId` NOT NULL drop:**
- `provider_org_id_name_idx` is `UNIQUE (org_id, name)`. After Stage 1 makes `provider.org_id` nullable for catalog rows, two catalog providers (`org_id = NULL`) with the same name would NOT collide in a standard unique index (because `NULL != NULL`). To preserve uniqueness within each scope layer, replace this index with TWO partial unique indexes:
  - `UNIQUE (org_id, name) WHERE org_id IS NOT NULL` — uniqueness for org-scoped rows.
  - `UNIQUE (name) WHERE kind = 'catalog'` — uniqueness for catalog rows.
- Repeat the same pattern for any other `UNIQUE (org_id, name)` indexes on waterfall feature tables. Audit at slice-plan time: grep `uniqueIndex.*org_id.*name` against `schema.ts`.

UPDATE all existing rows to set `kind = 'catalog'` and ensure all four scope columns are NULL where they previously had values (rip-and-replace authorized — the data being lost is dev/UAT seed data only).

*Explicitly out of scope for the waterfall (do NOT add scope columns):*
- `pipeline`, `pipeline_stage`, `pipeline_run`, `stage_run`, `deploy_run`, `stage_gate_result`, `isolation_environment` — execution rows, keep `projectId NOT NULL`.
- `issue` and all `issue_*` tables — per-project data.
- `issueType`, `issueState`, `issueStatus`, `issuePriority`, `issueLabel`, `issueTransition` — issue catalog; keeps its existing global-or-project two-layer model.
- `memory`, `configEntry`, `cronJob`, `personaSkill`, `driverRevision`, `skillRevision` — see spec rationale.

*Auth identity:*
- No schema change to `user.id`. The invariant "`user.id` = `auth.users.id`" is documented in the spec; Stage 1 adds a SQL comment on the `user.id` column referencing the spec, and a `user.id` seed assertion in Stage 2.

**Scope boundary:**

- Schema + migration SQL + nuke script. No seed rewrites. No code consuming the new shape.
- The old `team` and `team_member` tables get DROPPED in this stage's migration. Code references will break — that's intentional and gets repaired in stage 5.
- **e2e specs that test dropped-column behavior must be `test.skip(...)`-ed in Stage 1** with an explicit FLX-239 comment pointing at the cross-stage rule (below). The skipped specs get semantic rewrites in Stage 7 when the new UI lands. Known-affected specs (verified at this writing — slice plan re-audits at slice-plan time):
  - `e2e/team-crud.spec.ts` — tests old project-scoped team with persona members.
  - `e2e/flx-252-create-entity-form.spec.ts` — asserts a `Scope` label on the Skills create form; `skill.scope` is dropped in Stage 1.
  - `e2e/settings-url-context.spec.ts` — creates a project via `project.create` with a `userId` field; `project.user_id` is dropped in Stage 1, and the spec navigates to old `/{org}/{user}/{project}/settings/teams` URLs.

  Slice-plan audit at Stage 1 time: `grep -nE "settings/teams|teamMember|persona.*team|getByLabel\\('Scope'\\)|userId:.*project|orgId:.*provider" e2e/*.spec.ts`. Anything that hits gets skipped; the Stage 7 slice plan inherits the list.

**Hard rules for this stage:**

- No reading any of the new tables from app code in this stage. Schema only.
- Migration must apply cleanly on a freshly-nuked dev DB. For UAT: operator runs `tsx src/scripts/db/nuke.ts && npm run db:migrate` manually before deploying. **No "must apply against existing UAT rows" requirement** — rip-and-replace explicitly authorized.
- **RLS policy audit before the migration runs.** Postgres drops policies when their owning table is dropped, but policies on *other* tables that REFERENCE a dropped table raise errors. Before merging Stage 1, audit Supabase RLS policies: `SELECT schemaname, tablename, policyname, qual FROM pg_policies WHERE qual LIKE '%team%' OR qual LIKE '%team_member%';` — if any reference the old `team`/`team_member` shape, drop or rewrite them in the same migration.
- **Triggers are hand-written SQL.** Drizzle's schema definition does not support inline trigger declarations. The `project.org_id` denormalization trigger must be written by hand in the migration SQL file. Drizzle's `db:generate` will not produce it from `schema.ts` alone.

**Verification gate (must pass before stage 2 starts):**

1. `tsx src/scripts/db/nuke.ts && npm run db:migrate` — applies cleanly from scratch.
2. `npm run db:generate` — produces no schema drift (codegen and `schema.ts` are in sync).
3. Boot dev server: `npm run dev -- -H 0.0.0.0 -p 3004` — server starts even though most routes will 500 on data fetches (expected).
4. PR opens with the migration + schema only; no other files. Spec section "Schema changes" mapping made explicit in PR body.

**Estimated PR shape:** one big migration PR. Heavy on the SQL files; light on TS.

**Slice plan filename when written:** `docs/superpowers/plans/YYYY-MM-DD-flx-239-stage-1-schema.md`

---

## Stage 2 — Seed rewrite

**Spec sections satisfied:** "Acceptance" bullet "Seed creates one customer + one org + one team + one user, with the user as team member, and a default project under the team, with the user as project member."

**Files affected:**

- `src/scripts/db/seed.ts` — full rewrite. New default-org's create flow: customer row → org pointing at it → team in the org → user in the org → team_member (user↔team) → project under the team → project_member (user↔project).
- `tests/verify/seed-data.ts` (or wherever seed verification lives) — updated to expect the new shape.
- All feature catalog seed sections (personas, skills, drivers, harnesses, models, brands, pipelines, routing profiles) — verify they all have `kind='catalog'` and all four scope columns NULL.

**Scope boundary:**

- Seed and seed verification ONLY. No app code changes.
- The seed creates fixed UUIDs for the default org / team / user / project (so e2e specs can reference them deterministically). The existing `defaultOrgId`, `defaultUserId`, `defaultProjectId` constants in the seed/test fixtures gain a `defaultTeamId`, `defaultCustomerId`.

**Hard rules:**

- All catalog feature rows must have ALL FOUR scope columns NULL and `kind='catalog'`. The CHECK constraint will reject anything else.
- The default project's `team_id` is the default team. `project.org_id` is NOT set by the seed — the Stage 1 trigger fills it from `team.org_id`.
- **Auth identity invariant:** the seeded default user's `user.id` must equal the corresponding `auth.users.id` of the Supabase auth account (via Supabase admin API, fixed UUID in both). `verify:seed` includes an assertion `SELECT id FROM auth.users WHERE id = <DEFAULT_USER_UUID>` returns one row.
- **Denormalization invariant:** `verify:seed` includes an assertion `SELECT 1 FROM project p JOIN team t ON t.id = p.team_id WHERE p.org_id <> t.org_id` returns zero rows.

**Verification gate (must pass before stage 3):**

1. `tsx src/scripts/db/nuke.ts && npm run db:seed` — runs cleanly.
2. `npm run verify:seed` — passes.
3. `npm run db:studio` — manual eyeball of the seed result; one of each entity at the right scope.
4. `npm run db:issues`, `npm run db:runs` — both run cleanly against the new DB (queries succeed; rows may be empty).

**Slice plan filename when written:** `docs/superpowers/plans/YYYY-MM-DD-flx-239-stage-2-seed.md`

---

## Stage 3 — Waterfall helper (`resolveScoped<T>`)

**Spec sections satisfied:** "Read resolution" (the helper itself), uniform inheritance mechanic.

**Files affected:**

- `src/core/services/resolve-scoped.ts` — new file. The helper.
- `src/__tests__/integration/resolve-scoped.test.ts` — new file. Integration tests against real Supabase covering every layer combination (catalog only / org override / team override / user override / project override / each layer at once).
- `src/core/db/schema.ts` — possibly a small shared `scopeColumns` mixin / type if it helps DRY the consumer side. (Don't over-engineer in this stage; if it doesn't help, skip it.)

**Scope boundary:**

- Helper + tests ONLY. No consumer migration.
- Helper signature (locked):

  ```ts
  type ScopeContext = {
    projectId?: string | null;
    userId?: string | null;
    teamId?: string | null;
    orgId?: string | null;
  };

  resolveScoped<T>(
    db: Database,
    table: PgTable,
    ctx: ScopeContext,
    // optional: extra WHERE clause for filtering (e.g., by feature name)
    extraWhere?: SQL,
  ): Promise<T | null>;

  resolveScopedAll<T>(
    db: Database,
    table: PgTable,
    ctx: ScopeContext,
    dedupeKey: keyof T,         // column name to deduplicate on (e.g., 'name', 'identifier')
    extraWhere?: SQL,
  ): Promise<T[]>;
  ```

  `resolveScoped` returns the single highest-priority row (first match walking project → user → team → org → catalog). `resolveScopedAll` returns all rows across all layers, deduplicated by `dedupeKey`: for each distinct value of that column, the highest-priority layer wins; lower-layer rows with the same key are dropped.

  Per-table `dedupeKey` choices (locked at v1):
  - `persona.name`, `skill.name`, `routingProfile.name`, `brand.name`, `provider.name`, `driver.name` — natural single-column name keys.
  - `model` and `routingRule` are NOT waterfall-scoped (they inherit via their parent provider/routingProfile), so `resolveScopedAll` is never called on them. The composite-key question is moot.

  `dedupeKey: keyof T` is therefore always a single column name in v1. Drizzle does not have a built-in `DISTINCT ON`; the implementer uses a raw `sql` template literal for the clause.

  Stage 3 ships both helpers; later stages choose which to use per call site.

**Hard rules:**

- Helper issues a single SQL query with `ORDER BY` over a CASE that ranks rows by layer (project=1, user=2, team=3, org=4, catalog=5), `LIMIT 1` for the single variant. No N+1. No application-level looping over layers.
- Helper fails fast on contradictory input: if both `projectId` and `userId` provided, that's fine (a project ctx implies a user); if a CHECK-violating row is somehow encountered (multi-scope), the helper throws. No silent defaults.

**Verification gate (must pass before stage 4 starts being merged, but stage 4 can overlap in development):**

1. `npx vitest src/__tests__/integration/resolve-scoped.test.ts` — green. Coverage: each of the 5 layers in isolation, plus a stack of all 5, plus the "what wins" cases for every pair.
2. `npm run build` — TypeScript clean.

**Slice plan filename when written:** `docs/superpowers/plans/YYYY-MM-DD-flx-239-stage-3-resolve-scoped.md`

---

## Stage 4 — Routing migration (`/p/{uuid}/...`)

**Spec sections satisfied:** "URLs", "Routing + page changes".

**Files affected:**

- `src/app/p/[projectUuid]/**` — new route tree. Mirrors current `src/app/[org]/[user]/[project]/**`. ~36 page/component files moved + updated to take `projectUuid` instead of three slug params.
- `src/lib/resolve-context.ts` — rewritten signature:
  ```ts
  // before
  function resolveContext(orgSlug, userSlug, projectSlug): { orgId, userId, projectId }
  // after
  function resolveContext(projectUuid): {
    orgId: string;
    teamId: string;
    projectId: string;
    currentUserId: string;        // session user; throws if not authorized
    assertProjectAccess(): void;  // re-validates per call
  }
  ```
  Per spec: member enumeration (who else has access) is NOT in this return type. Pages call a dedicated `project.listMembers(projectId)` tRPC procedure when they need the member list.
- `src/app/[org]/[user]/[project]/**` — KEPT in place this stage with a wrapper that 307-redirects to `/p/{uuid}/...`. The slug-to-UUID lookup logic that the OLD `resolveContext` performs must be extracted into a dedicated `src/lib/resolve-slug-to-uuid.ts` helper (read-only; one query per request) BEFORE `src/lib/resolve-context.ts` is rewritten with the new UUID-based signature. The redirect wrapper calls the helper; the helper reads the slug columns (which survive Stage 1; only dropped in Stage 8). This buys overlap room for stages 5/6/7 work without breaking existing bookmarks/dev workflows mid-migration.
- Any `<Link>` or `useRouter().push()` that builds an `/{org}/{user}/{project}/...` URL — updated to use a new `projectPath(projectUuid, ...)` helper from `src/lib/url.ts`.
- Issue / run pages: `src/app/i/[issueUuid]/` and `src/app/r/[runUuid]/` (new top-level routes if they don't already exist).

**Scope boundary:**

- Routing + `resolveContext` shape ONLY. Routers' tRPC procedures continue to take whatever inputs they take (slug-based or id-based — stage 5 cleans those up).
- The 307 redirect from old to new path is a TEMPORARY scaffold to keep stages 5–7 unblocked. Stage 8 deletes it.

**Hard rules:**

- `resolveContext(projectUuid)` MUST authorize the current session user against `project_member` OR `team_member`-for-project's-team. If neither, throw — no silent passthrough.
- Authorization is done in `resolveContext`, not in individual pages. Pages assume access if `resolveContext` returns.

**Verification gate (must pass before stage 5 starts):**

1. Dev server boots; navigating to `/p/<seeded-project-uuid>/issues` renders the issues page.
2. Navigating to the old `/{org}/{user}/{project}/issues` URL 307s to `/p/<uuid>/issues`.
3. A logged-out / wrong-user session hitting `/p/<uuid>/...` is denied with a clear error (not a partial render).
4. `npm run build` — TypeScript clean.
5. The `e2e/full-issue-lifecycle.spec.ts` journey runs **only on the new URLs**, not the old redirects. The redirect path is exercised in a dedicated tiny spec.

**Slice plan filename when written:** `docs/superpowers/plans/YYYY-MM-DD-flx-239-stage-4-routing.md`

---

## Stage 5 — Router scope migration

**Spec sections satisfied:** "Routing + page changes" (router half), access control via `assertProjectAccess`.

**Files affected:**

- `src/server/routers/*.ts` — every router (19 files). Each gets:
  1. Replace `assertProjectOwnership(ctx, projectId)` calls with `assertProjectAccess(ctx, projectId)`.
  2. Procedures that scoped by `userId` for authorization purposes (e.g., "user's own projects") replaced with membership queries.
- `src/server/trpc.ts` (or wherever the auth helper lives) — new `assertProjectAccess(ctx, projectId)` helper. Looks at `project_member` and `team_member`-for-project's-team.
- `src/server/routers/project.ts` — `project.list` becomes "projects the current user is a member of via project_member, plus projects in teams the user is a member of via team_member". `project.update` requires `assertProjectAccess` with sufficient role.
- `src/server/routers/user.ts`, `team.ts` — new procedures for managing memberships (`team.addMember`, `project.addMember`, etc.) where it makes sense. (Don't blow scope; stick to procedures the UI actually calls.)

**Scope boundary:**

- Router authorization + membership queries ONLY. Feature-table reads continue to take whatever path they currently take (stage 6 handles those).
- DELETE the old `assertProjectOwnership` helper at the end of this stage if every caller is migrated; otherwise leave it and clean up in stage 8.

**Hard rules:**

- Every router that currently uses `userId` for authorization must be audited. Don't blindly replace — some `userId` uses are legitimate scope queries (e.g., "show me MY issue list"), not authorization. Authorization → `assertProjectAccess`. Scope → keep `userId` if still meaningful.
- The audit goes in the slice plan: a table per router listing every procedure and its mapping (authorization vs scope vs delete).
- **Auth identity invariant (per spec):** `src/server/trpc.ts`'s viewer resolver already enforces `user.id === authUserId` structurally (the existing `WHERE user.id = authUserId` JOIN is the invariant). The new `assertProjectAccess` relies on this — no new in-code assertion is needed. The Stage 2 `verify:seed` assertion catches a broken seed; the Stage 5 work is to ensure `getViewerContext` produces a typed error when `fluxaUserId` is null AND the request is NOT a LAN-bypass path (today it would silently fall through to the "viewer" role default).
- **LAN bypass passthrough:** today `assertProjectOwnership` (in `src/server/ownership.ts`) returns silently when `fluxaUserId === null` to permit unauthenticated dev/Playwright traffic. `assertProjectAccess` preserves this exactly: when `fluxaUserId === null` AND `FLUXAOS_LAN_AUTH_BYPASS=1`, the helper returns without consulting `project_member` or `team_member`. Semantically: null user = treated as having access to all projects (dev-only). Document this in the helper's doccomment.

**Verification gate (must pass before stage 6 starts):**

1. Every existing integration test in `src/__tests__/integration/*` updated to seed memberships before calling procedures.
2. New integration test for `assertProjectAccess` LAN bypass: a request with `fluxaUserId = null` and `FLUXAOS_LAN_AUTH_BYPASS=1` passes membership check without consulting `project_member`/`team_member`. Without this test, a regression that breaks LAN bypass would only surface in dev/Playwright, not in CI.
3. `npx vitest src/__tests__/integration/` — all green.
4. Manual smoke: dev server, log in as default user, navigate to a project I'm a member of (works), navigate to a project I'm NOT a member of (denied), navigate to a project where I have team access but no project grant (works via team).

**Slice plan filename when written:** `docs/superpowers/plans/YYYY-MM-DD-flx-239-stage-5-router-scope.md`

---

## Stage 6 — Feature-table consumers → `resolveScoped`

**Spec sections satisfied:** "Waterfall config" consumer side.

**Files affected:**

Every place that reads a feature row at a tenant context. Identified by grep'ing for `db.select().from(persona)`, `from(skill)`, `from(model)`, etc. Sample known locations:

- `src/core/services/persona-service.ts` (or wherever persona lookups happen)
- `src/core/services/skill-service.ts`
- `src/core/services/brand-service.ts`
- `src/server/routers/pipeline.ts` — pipeline definitions read
- `src/server/routers/routing.ts` — routing profile / rule reads
- `src/core/orchestrator/stage-executor.ts` — picks model/persona/skill at stage run time
- `src/adapters/langgraph/langgraph-stage-runner.ts` — reads stage config

**Scope boundary:**

- ONLY feature-row reads at a tenant context. Writes are unchanged (the UI form for editing a persona at org level just inserts a row with `org_id` set; that's existing CRUD).
- The slice plan will produce an exhaustive grep'd list of call sites before any are migrated.

**Hard rules:**

- After this stage, no production code path reads `from(persona)` (or other feature tables) without going through `resolveScoped` for tenant-context reads. Direct `from()` queries are allowed only for admin / catalog management endpoints (e.g., the Settings → Personas RecordEditor that lists all rows the user can see across layers — that uses `resolveScopedAll`).
- The orchestrator stage runner must resolve feature rows once at stage-acquire time and pass them down; no resolve-on-every-row.
- **`persona.parentPersonaId` semantics under the waterfall** (M2): the column survived Stage 1 unchanged. Slice plan must decide: does `resolveScoped(persona)` follow the parent chain when assembling a persona's effective config, or is the parent reference informational only (display "extends X")? Default decision (overridable in slice plan): parent chain is informational, not resolved. If the slice plan needs parent-chain resolution, document why and add tests for the multi-level case.

**Verification gate (must pass before stage 7):**

1. `npm run build` — clean.
2. `npx vitest src/__tests__/integration/` — green. New tests added that exercise org-override-of-catalog and project-override-of-org for at least 2 feature tables (persona, brand are good picks because the most flow paths use them).
3. Manual smoke: create a project-level persona override in the dev DB, run the pipeline, verify the override took effect via `npm run db:events`.

**Slice plan filename when written:** `docs/superpowers/plans/YYYY-MM-DD-flx-239-stage-6-feature-consumers.md`

---

## Stage 7 — E2E spec updates

**Spec sections satisfied:** "Acceptance" full-issue-lifecycle journey + URL shape.

**Files affected:**

- `e2e/helpers/setup.ts` — **central chokepoint**. `projectPath()` and any `defaultOrg`/`defaultUser`/`defaultProject` slug-based helpers updated to build `/p/{uuid}/...` paths from a `FLUXAOS_PROJECT_UUID` env var (replacing the three slug env vars). Updating this alone fixes most call sites.
- `e2e/*.spec.ts` — ~47 specs reference seed defaults or call `projectPath()`. Most go through the helper and need zero changes once the helper is updated. The slice plan begins by running `grep -rln "defaultProject\|defaultOrg\|defaultUser\|projectPath" e2e/` to produce the authoritative list, then categorizes each as "via helper (no change)" vs "direct URL or DB ref (needs edit)."
- `e2e/full-issue-lifecycle.spec.ts` — the canonical full-lifecycle journey. Must pass against the new URL shape.
- `.env.example` and Playwright env loading — switch `FLUXAOS_ORG_SLUG`/`USER_SLUG`/`PROJECT_SLUG` to `FLUXAOS_PROJECT_UUID` (with the seed setting it deterministically). `.env.example` MUST land in the same PR as the helper change. `e2e/helpers/setup.ts` throws at module load if the required env vars are missing — any drift between `.env.example` and the helper produces a confusing missing-env error that masks the underlying epic transition.

**Scope boundary:**

- Spec updates only. Underlying app behavior is final by this stage.

**Hard rules:**

- Every spec that currently builds a URL from slug-based segments switches to UUID-based via the helper.
- Specs that create their own test users / teams (via API or DB seed extension) must create the appropriate memberships (`team_member`, `project_member`) too.
- `e2e/full-issue-lifecycle.spec.ts` is the gate: must pass 100% before the stage's PR merges (project-wide rule from CLAUDE.md).

**Verification gate (must pass before stage 8):**

1. Full Playwright suite green (`npx playwright test`).
2. `e2e/full-issue-lifecycle.spec.ts` green specifically.
3. Pre-push hook Gate 3 satisfied for any UI-touching companion changes (separate spec for any UI changes; in this stage, only e2e edits).

**Slice plan filename when written:** `docs/superpowers/plans/YYYY-MM-DD-flx-239-stage-7-e2e.md`

---

## Stage 8 — Cleanup

**Spec sections satisfied:** "Schema changes (deleted)" — remove dead code that survived earlier stages because it was load-bearing.

**Files affected:**

- `src/app/[org]/[user]/[project]/**` — DELETE the entire old route tree (including the temporary 307 redirect).
- `src/lib/resolve-context.ts` — drop any lingering slug-aware code paths.
- `src/server/routers/*.ts` — drop `assertProjectOwnership` and any other ownership helpers if any caller still references them.
- `src/core/db/schema.ts` — drop `slug` columns from project, issue, run, etc. (where they exist and are now unused).
- Any drizzle migration to drop those slug columns. (One small final migration.)

**Scope boundary:**

- Pure deletion + small-final-migration. No new behavior.

**Hard rules:**

- Every deletion must be preceded by a grep proving zero refs remain. The slice plan template includes a grep checklist per deletion candidate.
- **Ordering within the stage-8 PR matters.** The 307 redirect (from Stage 4) does a slug→UUID DB lookup using `project.slug`/`organization.slug`/`user.slug`. Slug columns can only be dropped AFTER the redirect code is deleted. Concrete commit order inside the stage-8 PR:
  1. Delete `src/app/[org]/[user]/[project]/**` route tree (redirect goes away).
  2. Delete other dead helpers (`assertProjectOwnership`, slug-aware `resolveContext` paths).
  3. Drop slug columns in a small drizzle migration.
  Reversing 1 and 3 breaks the dev/UAT server for any in-flight old-URL bookmark hit during the deploy window.

**Verification gate (must pass before declaring FLX-239 done):**

1. `npm run lint`, `npm run build`, `npx vitest`, `npx playwright test` — all green.
2. `tsx src/scripts/db/nuke.ts && npm run db:migrate && npm run db:seed && npm run verify` — full reset cycle green.
3. `bash ops/git-hooks/session-audit.sh report` clean.
4. Linear FLX-239 transitioned Done with all 8 PR links attached.

**Slice plan filename when written:** `docs/superpowers/plans/YYYY-MM-DD-flx-239-stage-8-cleanup.md`

---

## Cross-stage rules

1. **Sequencing:** 1→2→3 hard sequential. Stages 4, 5, 6 can overlap *in development* if carefully sliced, but each PR depends on the prior stage's PR being merged. Stage 7 follows 4+5+6. Stage 8 is last.

2. **Per-stage handoff:** When stage N ships, the next session begins by:
   - Verifying main is at the stage-N merge commit.
   - Reading the stage-N PR's "what we learned" section in its body (if any) before writing the stage-(N+1) plan.
   - Invoking `superpowers:writing-plans` for the stage-(N+1) plan.

3. **Linear hygiene:** every stage PR is linked to FLX-239 via `Refs FLX-239` in the commit message. Linear FLX-239 stays In Progress through stages 1-7 and only flips to Done after stage 8 merges.

4. **Spec is binding.** If a stage discovers the spec is wrong, STOP. Update the spec via a follow-up commit on the current stage's branch, then continue. Do not silently diverge.

5. **No production, no users override applies.** Free to nuke + reseed the dev DB at every stage boundary. UAT operator decides when to do the same on UAT.

6. **Realtime subscriptions.** Existing Realtime subscriptions on `issue_event`, `pipeline_run`, `stage_run` etc. continue to work unchanged — those tables don't get scope columns. **No new Realtime subscriptions are added** by FLX-239 (membership tables `project_member`/`team_member` are read at page load, not subscribed). Mid-session membership changes require a page refresh in v1; live membership updates are an explicit follow-on if needed.

7. **Customer placeholder determinism.** The seed creates the default `customer` row with a fixed UUID (committed in the seed source). UAT operator never directly touches the `customer` table; rip-and-replace reseeds restore it to the same UUID. No risk of drift between dev and UAT.

---

## Self-review notes

- **Spec coverage:** every Acceptance bullet in the spec maps to a verification gate above. ✓
- **Placeholder scan:** no TBDs, no "TODO", no "implement later". ✓
- **Type consistency:** `resolveContext` signature locked in Stage 4 and matches spec ("Routing + page changes" section). `resolveScoped`/`resolveScopedAll` signatures locked in Stage 3 with `dedupeKey` parameter; consumed unchanged in Stage 6. ✓
- **Scope check:** epic is 8 stages, each a single-PR-sized slice. Reasonable.
- **Ambiguity:** "Routers that scoped by `userId` for authorization" vs "scope queries" disambiguated in Stage 5 hard rules. ✓

**Revisions from plan-review round 4 (2026-05-18) — verdict was `proceed`; these are sharpenings, not blockers:**
- Stage 1: slug columns explicitly NOT dropped in Stage 1 (deferred to Stage 8 because Stage 4's redirect needs them). `organization.slug`, `user.slug`, `project.slug` all live through Stages 1–7.
- Stage 1: skip-spec audit broadened beyond team-crud to include `flx-252-create-entity-form.spec.ts` (Scope field) and `settings-url-context.spec.ts` (uses project.create with userId). Audit grep pattern updated.
- Stage 1: hard rule added for RLS policy audit before migration (Supabase RLS can reference dropped tables).
- Stage 1: hard rule added clarifying triggers are hand-written SQL (Drizzle codegen won't produce them).
- Stage 4: slug-to-UUID lookup logic extracted to `src/lib/resolve-slug-to-uuid.ts` BEFORE `resolve-context.ts` is rewritten, so the redirect scaffold still has a working lookup during Stages 4–7.

**Revisions from plan-review round 3 (2026-05-18):**
- Stage 1: `brand.project_id` added to the pre-existing-column drop list (would have hit the same collision as persona/skill).
- Stage 1: index sequencing — `project_user_slug_idx` must be dropped before `project.user_id` to avoid Drizzle codegen emitting `DROP COLUMN` without `CASCADE`.
- Stage 1: unique-index repair — `provider_org_id_name_idx` (and similar) replaced with two partial indexes after `org_id` becomes nullable, so catalog rows don't silently lose name uniqueness.
- Stage 1: e2e/team-crud.spec.ts marked `test.skip(...)` in Stage 1 with FLX-239 comment; full semantic rewrite scheduled for Stage 7.
- Stage 3: `dedupeKey` locked as single-column only since `model`/`routingRule` are out of waterfall; composite key question is moot.
- Stage 5: explicit integration-test gate for `assertProjectAccess` LAN bypass; auth-identity wording corrected (invariant is structurally enforced in trpc.ts today).
- Stage 7: `.env.example` MUST land atomically with the helper change.
- Spec: `team.org_id` immutability declared (no team-org-move in v1; would need a second trigger).
- Spec: new `team` table now includes `version` column for RecordEditor optimistic concurrency (matches old-team pattern).

**Revisions from plan-review round 2 (2026-05-18):**
- Stage 1: explicit DROP of pre-existing `persona.scope`/`persona.project_id` and `skill.scope`/`skill.project_id` columns before adding waterfall columns (would have caused Postgres "column already exists" error on the migration).
- Stage 1: `model` and `routingRule` REMOVED from waterfall list — they're child rows of `provider`/`routingProfile` and inherit scope through their parent. Spec updated to match.
- Stage 1: `gateConfig` removed (no such table in current schema; was a speculative inclusion).
- Stage 1: Drizzle relation edits (`personaRelations`, `skillRelations`) explicitly in scope so `npm run build` stays green.
- Stage 5: LAN bypass passthrough behavior in `assertProjectAccess` explicit (null user = all projects, dev-only).
- Stage 6: `persona.parentPersonaId` semantics under the waterfall explicitly addressed (default: informational, not resolved).
- Spec acceptance criterion for "old routes return 404" rewritten to distinguish 307 (Stages 4–7) from 404 (Stage 8).

**Revisions from plan-review round 1 (2026-05-18):**
- Stage 1 expanded with concrete schema work list, explicit out-of-scope tables (pipeline/issue/etc.), NOT NULL drop list (provider/routingProfile/brand), and the `project.org_id` trigger.
- Stage 2 hard rules now include the auth-identity invariant assertion and the denormalization invariant assertion.
- Stage 3 `resolveScopedAll` signature now includes `dedupeKey` parameter; per-table dedupeKey choices locked.
- Stage 4 `resolveContext` return type clarified — no `userIds[]`; member enumeration goes through `project.listMembers`.
- Stage 5 hard rules now call out the trpc.ts viewer-resolver auth-identity dependency.
- Stage 7 file count corrected (47 specs via helper, not 15 hardcoded); helper chokepoint strategy added.
- Stage 8 ordering constraint inside the PR (delete redirect → delete helpers → drop slug columns) explicit.
- Cross-stage rule 6 (Realtime non-coverage) and 7 (customer placeholder determinism) added.
- Spec updated in parallel: pipeline removed from feature-table list; auth-identity contract section added; `resolveContext` shape clarified; trigger-based `project.org_id` enforcement specified; `resolveScopedAll` signature locked.

---

## Execution handoff

When you're ready to start stage 1, invoke `superpowers:writing-plans` for the stage-1 plan with the spec + this epic as inputs.

The stage-1 plan is the smallest unit of work that can ship and merge cleanly: schema only, with the verification gate of "migration applies clean + codegen has no drift". Estimated 1 PR.

Recommended subagent dispatch for stage-1 execution after the stage plan is written: `superpowers:subagent-driven-development` (one subagent per task with two-stage review). This keeps the main session clean for cross-stage decisions.
