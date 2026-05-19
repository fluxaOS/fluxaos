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

**Every feature row** follows the same shape — persona, model, harness, skill, provider, driver, pipeline, routing-profile, brand, gate-config, and any future feature row.

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
resolveScoped<T>(table, ctx: { projectId, userId, teamId, orgId }): Promise<T | null>
```

The helper issues a single SQL query with `ORDER BY` over a CASE that ranks rows by layer (project=1, user=2, team=3, org=4, catalog=5), `LIMIT 1`. No N+1.

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
- New `team` table: `id, org_id NOT NULL, name, description, created_at, updated_at`.
- New `team_member` table: `(user_id, team_id, role) PRIMARY KEY (user_id, team_id)`.
- New `project_member` table: `(user_id, project_id, role) PRIMARY KEY (user_id, project_id)`.
- `project.team_id NOT NULL` — every project belongs to a team.
- Four nullable scope columns + `kind` discriminator + CHECK constraint on every feature table.

### Modified

- `user.org_id`: still required.
- `organization.customer_id`: new nullable column (no FK, no NOT NULL).
- `project.org_id`: kept and denormalized from `team.org_id` for query speed; CHECK that `project.org_id = (SELECT org_id FROM team WHERE id = project.team_id)`. (Or compute at write time; design detail for plan.)

## Routing + page changes

Every page under `src/app/[org]/[user]/[project]/**` moves to `src/app/p/[projectUuid]/**`. The `resolveContext()` helper changes shape:

```ts
// before
function resolveContext(orgSlug, userSlug, projectSlug): { orgId, userId, projectId }

// after
function resolveContext(projectUuid): { orgId, teamId, projectId, userIds[], currentUserId }
```

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
- All pages routed via `/p/{uuid}/...`. Old `[org]/[user]/[project]/...` routes return 404.
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
