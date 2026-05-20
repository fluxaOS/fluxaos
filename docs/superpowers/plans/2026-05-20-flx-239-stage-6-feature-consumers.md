# FLX-239 Stage 6: Feature Consumers ResolveScoped Migration

**Issue:** FLX-263
**Parent epic:** FLX-239
**Date:** 2026-05-20
**Branch:** `flx-263-stage6-feature-consumers`

## Goal

Migrate tenant-context feature-row reads to the Stage 3 waterfall helpers so project runtime and project settings resolve rows in priority order: project -> user -> team -> org -> catalog.

## Architecture

Stage 6 keeps writes and admin/catalog editing surfaces stable. It changes read paths that answer "what feature config applies to this project/user/team/org context?" to use `resolveScoped` or `resolveScopedAll`.

Feature rows referenced by FK from project runtime tables are treated as selectors by natural key, not immutable row IDs. Example: if `pipeline_stage.persona_id` points at catalog persona `Implementer`, and the project defines persona `Implementer`, stage execution must use the project persona. Implementation pattern:

1. Load the configured FK row only to discover its natural selector key (`name` for persona/brand/provider/routing profile/driver; `slug` remains driver identity for CLI/build-command where needed).
2. Resolve the effective row with `resolveScoped(..., extraWhere: eq(table.name, configured.name))` in the project scope context.
3. Pass the resolved row downstream once at stage acquire/launch time; do not re-resolve inside per-line/per-result loops.

`persona.parentPersonaId` remains informational in this slice. The parent chain is not recursively resolved when assembling effective persona config.

`model` and `routingRule` are not independently waterfall scoped. They inherit through the resolved `provider` and `routingProfile`, respectively.

## Scope Context

Add one shared helper in `src/core/services/resolve-scoped.ts`:

```ts
resolveProjectScopeContext(db, projectId): Promise<ScopeContext>
```

It loads `project.{id, orgId, teamId}` and a stable project user context. Project/user overrides are meaningful only when a user is known. Runtime paths do not currently know the interactive viewer, so runtime scope context uses `projectId`, `teamId`, and `orgId`; router paths that have `ctx.viewer.fluxaUserId` pass it as `userId`.

If the project row is missing, fail fast with a clear error. No fallback.

## Audit

Production feature-table reads found by `rg "from\\((persona|skill|brand|provider|driver|routingProfile|model|routingRule)\\)" src --glob '!src/__tests__/**'`:

| Path | Reads | Stage 6 action |
|---|---|---|
| `src/core/orchestrator/stage-runner.ts` | `driver`, `skill`, `persona` by stage/stageRun FK | Resolve configured driver/persona by natural key in project scope; resolve skill by natural key when a stage run selected a skill. |
| `src/core/orchestrator/stage-executor.ts` | `driver`, `persona`, all `skill` rows | Resolve driver/persona by natural key in project scope; replace all-skill read with `resolveScopedAll(skill, ..., 'name')`. |
| `src/core/orchestrator/routing-resolver.ts` | `routingRule` via `routingProfile`, provider/model candidates | Resolve effective routing profiles with `resolveScopedAll(routingProfile, ..., 'name')`, then rules under those profiles; resolve provider candidates with `resolveScopedAll(provider, ..., 'name')`, then models under selected providers. |
| `src/core/orchestrator/brand-resolver.ts` | `brand` by persona/project FK | Resolve configured brand by natural key in project scope; persona brand selector wins over project brand selector. |
| `src/core/services/persona.ts` | project/global list methods | Replace project/global list reads with scope-aware methods using `resolveScopedAll(..., 'name')`; keep CRUD by-id and FK count direct. |
| `src/core/services/skill.ts` | project/global list methods, revisions, reference counts | Replace project/global list reads with scope-aware methods using `resolveScopedAll(..., 'name')`; keep revisions/reference counts/direct mutation reads direct. |
| `src/core/services/brand.ts` | org/project/visible list methods | Replace visible project read with `resolveScopedAll(..., 'name')`; keep reference counts direct. |
| `src/core/services/provider.ts` | org provider list, model list by provider | Replace provider list with `resolveScopedAll(..., 'name')`; keep model list by provider under resolved provider. |
| `src/core/services/routing.ts` | org profile list, rule list by profile | Replace profile list with `resolveScopedAll(..., 'name')`; keep rule list by profile under resolved profile. |
| `src/core/services/driver.ts` | global list/get by slug/get by id/revision helpers | Add scope-aware list/resolve methods; keep revision and direct mutation helpers direct. |
| `src/core/services/project-fk-validators.ts` | validates `brand` FK | Validate by direct FK existence for writes; no waterfall read change unless it blocks effective brand resolution tests. |
| `src/server/routers/persona.ts`, `skill.ts`, `brand.ts`, `provider.ts`, `routing.ts`, `driver.ts` | project/org/catalog settings reads | Project-context reads use scope-aware service methods. Admin edit-by-id reads remain direct because they are row editing surfaces. |
| `src/scripts/db/seed.ts`, `src/scripts/orchestrator-demo.ts` | seed/demo direct reads | Out of scope; seed/demo scripts are not production tenant-context consumers. |

## Implementation Tasks

### Task 1: Plan And Branch

- [x] Create FLX-263 in Linear and mark In Progress.
- [x] Branch from merged Stage 5 main as `flx-263-stage6-feature-consumers`.
- [x] Commit this slice plan.

### Task 2: Scope Context And Service Read APIs

**Files:**
- `src/core/services/resolve-scoped.ts`
- `src/core/services/persona.ts`
- `src/core/services/skill.ts`
- `src/core/services/brand.ts`
- `src/core/services/provider.ts`
- `src/core/services/routing.ts`
- `src/core/services/driver.ts`

Steps:

- [x] Add `resolveProjectScopeContext(db, projectId, userId?)`.
- [x] Add scope-aware list methods for persona, skill, brand, provider, routing profile, and driver using `resolveScopedAll`.
- [x] Add scope-aware "effective by configured row id" helpers where runtime FKs need natural-key resolution.
- [x] Keep mutation, revision, count, and direct edit-by-id methods unchanged.
- [x] Commit.

### Task 3: Runtime Consumers

**Files:**
- `src/core/orchestrator/stage-runner.ts`
- `src/core/orchestrator/stage-executor.ts`
- `src/core/orchestrator/routing-resolver.ts`
- `src/core/orchestrator/brand-resolver.ts`

Steps:

- [x] Resolve the project scope context once per stage run/launch.
- [x] Resolve driver/persona/skill/brand rows once before materialization or prompt composition.
- [x] Resolve routing profiles/providers through waterfall helpers; enumerate child routing rules/models from the resolved parent rows.
- [x] Preserve fail-fast behavior when configured rows or effective rows are missing.
- [x] Commit.

### Task 4: Router Consumers

**Files:**
- `src/server/routers/persona.ts`
- `src/server/routers/skill.ts`
- `src/server/routers/brand.ts`
- `src/server/routers/provider.ts`
- `src/server/routers/routing.ts`
- `src/server/routers/driver.ts`

Steps:

- [x] Migrate project-context list endpoints to scope-aware list methods with `ctx.viewer.fluxaUserId`.
- [x] Leave admin/catalog edit-by-id endpoints direct after Stage 5 access checks.
- [x] For provider/routing settings that currently accept only `orgId`, keep catalog/org views direct unless a `projectId` is added by an existing route context; do not invent a second route contract in this slice.
- [ ] Commit.

### Task 5: Integration Coverage

**Files:**
- `src/__tests__/integration/resolve-scoped.test.ts`
- Add focused tests only if existing coverage cannot express consumer behavior.

Steps:

- [ ] Add persona org-over-catalog and project-over-org consumer tests.
- [ ] Add brand org-over-catalog and project-over-org consumer tests.
- [ ] Add a runtime-shaped test proving a configured catalog persona/brand resolves to a project override by `name`.
- [ ] Commit.

### Task 6: Verification

Steps:

- [ ] `npx biome check .`
- [ ] `npx tsc --noEmit --pretty false`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `set -a; source .env.local; set +a; npx vitest run src/__tests__/integration/resolve-scoped.test.ts`
- [ ] `set -a; source .env.local; set +a; npx vitest run src/__tests__/integration/project-access.test.ts`
- [ ] `set -a; source .env.local; set +a; npx vitest run src/__tests__/integration/`
- [ ] Manual smoke: create a project-level persona override, run a pipeline, verify via `npm run db:events`; document exact blocker if local runtime state prevents it.
- [ ] Commit verification notes if needed.

## Non-Goals

- No schema migration.
- No broad E2E rewrite; Stage 7 owns route/journey updates.
- No recursive `persona.parentPersonaId` resolution.
- No independent waterfall resolution for `model` or `routingRule`.
- No seed/demo script cleanup unless required to keep verification green.

## Risks

- Runtime lacks an interactive viewer, so user-level overrides cannot apply in daemon execution until a later stage adds an explicit run actor. Stage 6 will support user scope where router context provides it and document runtime context as project/team/org/catalog.
- Existing full integration failures from Stage 5 may still appear. Stage 6 must distinguish new consumer regressions from previously documented shared DB / fixture-state failures.
