# Session Handoff — Rich Issue Model Implementation

**Date:** 2026-04-09
**From:** Session 1 (forensic audit → rebuild phases R1-R3 partial)
**To:** Session 2 (implement rich issue model, continue rebuild)

## What to Do

### Step 1: Review the spec
Read `docs/superpowers/specs/2026-04-09-rich-issue-model-design.md`. This is the DA-reviewed design spec for the rich issue model. It defines 15 new/modified tables, API endpoints, UI requirements, migration strategy, and known limitations. The user has seen the spec but has not formally approved it — ask for approval before proceeding.

### Step 2: Check impact on other rebuild phases
Read the high-level rebuild plan at `docs/superpowers/plans/2026-04-09-rebuild-plan.md` and the rebuild spec at `docs/superpowers/specs/2026-04-09-rebuild-spec.md`. The issue model overhaul was not in the original plan — it emerged from user feedback during Phase R3 testing. Check each remaining phase for impact:

- **Phase R3 (in progress):** Services, tRPC routers, and UI for issues need to be rebuilt on the new schema. The current issue service at `src/core/services/issue.ts` and router at `src/server/routers/issue.ts` are built against the old simple model and must be replaced.
- **Phase R4 (Gate Engine):** The spec says gates reference `issue_state.key` instead of hardcoded enums. The gate engine design must account for DB-driven states. The `src/core/issues/types.ts` hardcoded enums get deleted.
- **Phase R5 (Pipeline Engine):** The pipeline engine needs to update `issue.status_id` via the config-driven status automation mapping. The git integration tables (branch, PR, commit) are placeholders in this spec — they become functional in R5.
- **Phase R6 (Polish + Ship):** The journey test list needs updating — many items now reference catalog-driven entities instead of hardcoded values.

Update the rebuild plan and spec if needed to reflect these impacts.

### Step 3: Write the implementation plan
Use the writing-plans skill to create a detailed task-by-task plan. The spec's migration strategy (15 steps) provides the ordering. Key considerations:

- Schema changes first (new tables, modify issue table, backfill)
- Then services (catalog CRUD, issue service rewrite, comment/attachment/dependency services)
- Then tRPC routers
- Then UI
- Integration tests at each layer
- User verifies in browser before marking complete

### Step 4: Implement
Execute the plan. The user wants to verify each major checkpoint in the browser. Key verification points:
- After schema migration: seed data visible in Supabase dashboard
- After services + tRPC: CRUD via curl/API works
- After UI: full issue lifecycle in browser (create, edit, transition, comment, attach, depend)

## Current Codebase State

### What's working
- Supabase Cloud Postgres connected (21 tables, transaction pooler)
- Supabase Auth (login/logout via proxy.ts)
- Adapter registry with DI (database, auth, queue adapters)
- tRPC with service factories (org, project, issue, skill, persona, pipeline, provider, routing, brand)
- Scoped URLs: `/[org]/[project]/issues/[id]`
- Basic UI: dashboard, create issue, issue detail with inline editing
- 7 integration tests against real Supabase
- Health endpoint: `/api/health`

### What needs to change
- `src/core/db/schema.ts` — add ~12 new tables, modify issue table
- `src/core/issues/types.ts` — DELETE (replaced by DB-driven catalogs)
- `src/core/services/issue.ts` — REWRITE for new schema
- `src/server/routers/issue.ts` — REWRITE for new endpoints
- `src/core/db/seed.ts` — extend to seed issue catalogs + transitions + status config
- `src/app/[org]/[project]/issues/` — REWRITE all issue UI pages
- `src/__tests__/integration/services.test.ts` — REWRITE issue tests for new schema

### Files to reference
- **PAT's issue models:** `/mnt/dev/pat/src/pat/core/orchestrator/models/issues_native.py`
- **PAT's seed data:** `/mnt/dev/pat/src/pat/core/orchestrator/issue_catalog_defaults.py`
- **PAT's issue schemas:** `/mnt/dev/pat/src/pat/core/orchestrator/schemas/issues.py`
- **PAT's issue routes:** `/mnt/dev/pat/src/pat/api/routes/v2/issues.py`
- **PAT's frontend types:** `/mnt/dev/pat/frontend/src/types/v2.ts`

## Supabase Details
- Project ref: zesinfsluyxiwzldeffa
- Region: aws-1-us-west-2
- Credentials in `.env` (gitignored)
- Schema push via `npx drizzle-kit push --force`

## Process Rules (non-negotiable)
1. No phase complete without user verification in browser
2. No autonomous architecture decisions — flag deviations
3. Integration tests hit real Supabase, not mocks
4. DRY strictly — use the CRUD factory pattern at `src/core/services/crud-factory.ts`
5. Fail fast, no fallbacks, no hardcoded values
6. Max ~500 lines per file
7. Zero vendor imports in `src/core/` (except `import type` and drizzle-orm for schema)
8. Issues are the heart of the product — do not simplify the model

## How to Start the Session

```
Resume the fluxaOS rebuild. Read the session handoff at docs/superpowers/specs/2026-04-09-session-handoff.md, then:
1. Get user approval on the rich issue model spec
2. Check remaining rebuild phases for impact
3. Write the implementation plan
4. Implement
```
