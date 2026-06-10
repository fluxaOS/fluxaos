# FLX-239 — Tenancy + Waterfall Config Design

**Status:** approved 2026-05-18
**Linear:** [FLX-239](https://linear.app/rebos/issue/FLX-239/tenancy-model-brainstorm-customer-org-team-user-project)

## Goal

Redesign tenancy to support:

- Multi-tenant SaaS shape (customer → org → team → user → project).
- N projects per user *and* N users per project.
- Permission scope via teams.
- Uniform Kopia-style waterfall inheritance for every feature row (persona, model, harness, skill, provider, driver, pipeline, routing-profile, brand, etc.).

## Hierarchy

```
customer (placeholder, see below)
  └── organization
        ├── team           (permission group of users)
        ├── user           (belongs to one org)
        └── project        (belongs to one team for default access)
              ↕ user       (M:N via project_member for per-user grants)
        ↕ team             (M:N user ↔ team via team_member)
```

Cardinalities:

- `customer → organization`: 1:N (nullable FK; placeholder)
- `org → team`: 1:N
- `org → user`: 1:N
- `org → project`: 1:N (via team's org; denormalized for query speed)
- `team ↔ user`: M:N via `team_member (user_id, team_id, role)`
- `user ↔ project`: M:N via `project_member (user_id, project_id, role)`
- `project → team`: each project belongs to exactly one team for default team-wide access; per-user grants layer on top.

### Access rule

A user U can see project P iff:

1. U is in `project_member` for P (explicit per-user grant), OR
2. U is in `team_member` for `P.team_id` with sufficient role (default team-wide).

## Auth identity contract

The fluxaOS `user` table is a profile table that mirrors `auth.users` 1:1. Specifically:

- `user.id` (uuid PK) is set to the Supabase `auth.users.id` of the corresponding auth account. This is an invariant, not a coincidence.
- New user creation (Sign-up flow or admin invite) inserts the `user` row with `id = auth.users.id` as part of the same transaction that records the auth event.
- The seed sets `user.id` to a fixed UUID and creates a Supabase auth user with the same UUID (via the admin API) so `trpc.ts`'s viewer resolver can match `user.id === authUserId` from the JWT subject.
- No separate `auth_user_id` column. The invariant is the FK.

`resolveContext` and `assertProjectAccess` look up the session user by JWT subject, hit `user.id`, then check `project_member.user_id` and `team_member.user_id` for access.

If the invariant is ever broken (e.g., a user row is created without a matching auth account), every authorization check for that user fails closed. There is no fallback to LAN bypass for production paths; LAN bypass exists only for unauthenticated dev/Playwright traffic where no JWT is present.

## Customer placeholder

**Customer is reserved for future billing/identity. Not implemented, not enforced, not in UI in v1.**

- `customer` table exists in schema. Minimal columns: `id`, `created_at`, `updated_at`, `external_billing_id text` (placeholder).
- `organization.customer_id` is a nullable `uuid` column. No FK constraint, no NOT NULL.
- Seed creates one default `customer` row and points the default org at it so the relationship is exercised end-to-end (prevents bit-rot).
- No routers, no UI, no auth changes around customer in v1.
- **Do not hang any logic on `customer_id` until a separate epic enables billing** (estimated ~6 months out at time of writing).

## URLs

```
/p/{project_uuid}/...
/i/{issue_uuid}
/r/{run_uuid}
```

- UUID-only. No slugs in URLs. No org/team in URL.
- Display names (`name` column) are free-text and unconstrained — collisions across users / teams / orgs are allowed.
- Single-letter prefixes (`/p/`, `/i/`, `/r/`, ...) so route files match cleanly and humans can tell at a glance what kind of URL they're looking at.
- App-layer helpers (copy-link, future shortener) can build pretty URLs without schema changes.

## Waterfall config (Kopia-style)

**Every feature row** follows the same shape — persona, skill, provider, driver, routing-profile, brand, and any future feature config row.

`model` and `routingRule` are NOT independently waterfall-scoped. They are structurally child rows (`model.providerId NOT NULL`, `routingRule.profileId NOT NULL`) and inherit scope through their parent. Read resolution for a model goes through `resolveScoped(provider)` first, then enumerates the chosen provider's models. Same for routing rules under their profile. Adding independent scope columns to `model`/`routingRule` would create "project-level model under catalog-level provider" ambiguity for no clear use case.

**Explicitly NOT in the waterfall** (these are execution / runtime / non-config rows):

- `pipeline`, `pipeline_stage`, `pipeline_run`, `stage_run`, `deploy_run`, `stage_gate_result`, `isolation_environment` — execution definitions and run records. They stay project-scoped (`projectId NOT NULL`). They *consume* feature config via the waterfall, but their own rows are not waterfall.
- `issue` and all `issue_*` tables (event, comment, branch, pull_request, commit, transition) — per-project data, not config.
- `issueType`, `issueState`, `issueStatus`, `issuePriority`, `issueLabel`, `issueTransition` — issue catalog. Already a two-layer model (nullable `projectId` distinguishes global vs project). Stays as-is in v1; can be considered for full waterfall later if needed.
- `memory` — per-tenant data with its own scope semantics; not a config row.
- `configEntry` — runtime/daemon configuration (workspace roots, cleanup thresholds); already has its own `scope` column model. Stays as-is in v1.
- `cronJob` — execution scheduling, not config.
- `personaSkill`, `team_member`, `project_member` — junction tables; their scope follows their parent rows.
- `driverRevision`, `skillRevision` — append-only history tables; tied to their parent driver/skill row's scope.

Driver and harness configuration are *features* (in waterfall); their *revisions* are not (they trail the parent row).

### Schema

Every feature table gets these columns:

| Column | Type | Notes |
|---|---|---|
| `org_id` | uuid | nullable |
| `team_id` | uuid | nullable |
| `user_id` | uuid | nullable |
| `project_id` | uuid | nullable |
| `kind` | text | discriminator: `catalog` / `org` / `team` / `user` / `project` |

CHECK constraint: exactly one of the four scope columns is non-null **and** `kind` matches that column, OR all four are null **and** `kind = 'catalog'`. Indexes on each scope column plus a partial index on `kind = 'catalog'`.

### Read resolution

A read at the project layer walks **project → user → team → org → catalog**, returning the first match. Implemented once as a shared helper:

```ts
type ScopeContext = {
  projectId?: string | null;
  userId?: string | null;
  teamId?: string | null;
  orgId?: string | null;
};

// Single highest-priority row (or null).
resolveScoped<T>(
  db: Database,
  table: PgTable,
  ctx: ScopeContext,
  extraWhere?: SQL,
): Promise<T | null>;

// All rows from all layers, deduplicated by `dedupeKey`. For each
// distinct value of `dedupeKey`, the highest-priority layer wins;
// lower-layer rows with the same key are dropped.
// dedupeKey is a typed column reference (e.g., persona.name, model.identifier).
resolveScopedAll<T>(
  db: Database,
  table: PgTable,
  ctx: ScopeContext,
  dedupeKey: keyof T,
  extraWhere?: SQL,
): Promise<T[]>;
```

The helper issues a single SQL query with `ORDER BY` over a CASE that ranks rows by layer (project=1, user=2, team=3, org=4, catalog=5), `LIMIT 1` for the single variant. `resolveScopedAll` uses `DISTINCT ON (dedupeKey)` with the same ordering. No N+1.

Per-table `dedupeKey` choices (locked at v1):
- `persona.name`, `skill.name`, `routingProfile.name`, `brand.name`, `provider.name`, `driver.name` — natural name keys on waterfall-scoped tables.
- `model` and `routingRule` are NOT waterfall-scoped (they inherit via their parent provider/routingProfile), so `resolveScopedAll` is not called on them directly.

### Write

Inserts are explicit at the layer being defined. No cascade-write. No backfill. Changing an upper-layer row reflects immediately at read time in all lower layers that haven't overridden it.

## Schema changes

### Deleted

- Existing `team` table (currently `project_id` + group-of-personas semantics).
- Existing `team_member` table (currently `team_id ↔ persona_id`).
- `project.user_id` FK (single owner → replaced by `project_member` M:N).
- All `slug` columns on entities that appear in URLs (project, issue, run, etc.). Existing `slug` columns that are *not* in URLs (e.g., for internal lookups) may be reviewed case-by-case.

### Added

- `customer` table (placeholder, see above).
- New `team` table: `id, org_id NOT NULL, name, description, version, created_at, updated_at` (`version` is the optimistic-concurrency column required by RecordEditor per FLX-124, matching the pattern used by other CRUD entities).
- New `team_member` table: `(user_id, team_id, role) PRIMARY KEY (user_id, team_id)`.
- New `project_member` table: `(user_id, project_id, role) PRIMARY KEY (user_id, project_id)`.
- `project.team_id NOT NULL` — every project belongs to a team.
- Four nullable scope columns + `kind` discriminator + CHECK constraint on every feature table.

### Modified

- `user.org_id`: still required.
- `organization.customer_id`: new nullable column (no FK, no NOT NULL).
- `project.org_id`: kept and denormalized from `team.org_id` for query speed. Postgres CHECK can't reference other rows, so enforcement is via a `BEFORE INSERT OR UPDATE ON project` trigger that **overwrites** `project.org_id` from `team.org_id` (caller can't set it independently). The seed and `project.create` procedure simply set `team_id` and let the trigger fill in `org_id`. Stage 2's `verify:seed` asserts the invariant.
- `team.org_id` is **immutable** after team creation. No procedure exposes a team-org-move operation; `team.update` excludes `org_id` from the mutable column set. Without this, the denormalized `project.org_id` could become stale (the trigger only fires on `project` writes, not `team` writes). If a team-org-move ever becomes a requirement, a second `BEFORE UPDATE ON team` trigger must cascade the new `org_id` to every dependent project — that's an explicit future feature, not v1.
- `provider.org_id`, `routing_profile.org_id`, `brand.org_id`: today these are `NOT NULL`. Under the waterfall, catalog-scoped rows have all four scope columns NULL, so the NOT NULL constraint must be dropped on every feature table that gains scope columns. Stage 1's migration drops these. The CHECK constraint enforces the new invariant (exactly one scope FK non-null, or all null for catalog).
- `persona` and `skill` each have **existing** `scope text NOT NULL default 'project'` and `project_id uuid` columns. These predate the waterfall and would collide with the new waterfall columns. Stage 1 drops both columns from each table before adding the new waterfall machinery. The corresponding Drizzle relation entries (`personaRelations`, `skillRelations`) are updated in the same migration PR so `npm run build` stays green.
- `persona.brandId`, `persona.routingProfileId`, `persona.parentPersonaId` — unrelated FK columns kept as-is. Stage 6 considers whether the orchestrator should walk `parentPersonaId` chains under the waterfall (no schema impact in Stage 1).

## Routing + page changes

Every page under `src/app/[org]/[user]/[project]/**` moves to `src/app/p/[projectUuid]/**`. The `resolveContext()` helper changes shape:

```ts
// before
function resolveContext(orgSlug, userSlug, projectSlug): { orgId, userId, projectId }

// after
function resolveContext(projectUuid): {
  orgId: string;
  teamId: string;
  projectId: string;
  currentUserId: string;        // session user; throws if not authorized
  assertProjectAccess(): void;  // re-validates per call (cheap; access already checked at resolve time)
}
```

Member enumeration (who else has access to this project) is **not** part of `resolveContext`. Pages that need the member list (assignee picker, mention UI, activity feed) call a dedicated `project.listMembers(projectId)` tRPC procedure that returns the union of `project_member` direct grants and `team_member`-via-team grants.

Authorization happens inside `resolveContext`: throws if the current session user lacks access via team or project membership.

Every tRPC router that authorizes access via `userId` or `orgId` (e.g., "user owns project") switches to membership-based authorization. A shared helper `assertProjectAccess(ctx, projectId)` replaces the existing `assertProjectOwnership`. Routers that *read* feature rows continue to use `orgId`/etc. — those are scope queries, not authorization queries, and route through `resolveScoped<T>()`.

## What's not in this spec

- **Customer billing implementation.** Customer is a placeholder; how billing actually works (Stripe integration, plan enforcement, quota) is a separate later epic.
- **Login / auth provider changes.** The current Supabase auth flow continues. Only what a logged-in user can see changes, not how they log in.
- **The routing-rules system.** Survives unchanged; still picks which persona runs which stage at the project layer. The personas it picks from now resolve via the waterfall.
- **Pipeline-stage execution.** Unchanged. Stage runner reads its config via the waterfall helper instead of direct project lookups.

## Acceptance

- Schema migrated rip-and-replace (no migration scripts; nuke + reseed).
- Seed creates one customer + one org + one team + one user, with the user as team member, and a default project under the team, with the user as project member.
- `resolveScoped<T>()` helper exists, unit-tested at the project layer with rows at every level.
- All pages routed via `/p/{uuid}/...`. Old `[org]/[user]/[project]/...` routes return 307 during Stages 4–7 (temporary scaffold) and 404 after Stage 8 cleanup.
  - **Deviation note (2026-06-10, FLX-271):** the 307 scaffold never survived to Stage 8. Stage 4 (FLX-263) deleted the entire old `[org]/[user]/[project]` route tree outright instead of shipping a redirect wrapper, so old routes have returned 404 since Stage 4. The 2026-06-10 audit adjusted Stage 8 scope accordingly: no redirect teardown — Stage 8 (FLX-271) only removed the `assertProjectOwnership` alias, the remaining slug-aware helpers (`*.getBySlug`, `getFirstBySlug`, `getByUserSlug`), and dropped the `organization.slug` / `user.slug` / `project.slug` columns (migration `drizzle/0033_flx_271_drop_tenancy_slugs.sql`).
- `assertProjectAccess` enforces access on every router that touches a project.
- Existing journey tests updated to use new URL shape; full-issue-lifecycle journey passes end-to-end.

## Implementation strategy

Big enough to be an epic, not a single PR. Decomposition (rough; refined in the plan):

1. **Schema migration** — drop old tables, add new tables, add scope columns to every feature table.
2. **Seed rewrite** — new shape (customer → org → team → user → project).
3. **Waterfall helper** — `resolveScoped<T>()` + tests.
4. **Routing migration** — `/p/{uuid}/...` page moves + `resolveContext` rewrite.
5. **Router scope migration** — replace `userId`/`orgId` filters with membership-based queries.
6. **Feature-table consumers** — every consumer of every feature row switches to `resolveScoped`.
7. **E2E spec updates** — new URLs, new access semantics.
8. **Cleanup** — drop unused helpers (`assertProjectOwnership`, etc.), delete dead `[org]/[user]/[project]` route files.

## History

Filed 2026-05-12 during FLX-207 brainstorm. Brainstormed 2026-05-18; decisions:

- Multi-tenant SaaS shape with customer at the top (placeholder only).
- M:N user↔team, M:N user↔project.
- UUID-only URLs; no slugs.
- Uniform Kopia-style waterfall (catalog → org → team → user → project) for every feature row.
- Rip-and-replace; no migration of old data.
