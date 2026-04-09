# Session Handoff — Rich Issue Model Complete

**Date:** 2026-04-09
**From:** Session 2 (rich issue model implementation)
**To:** Session 3 (continue rebuild — R4 Gate Engine or UI polish)

## What Was Accomplished

### Brainstorming Phase
- Deep-dived PAT codebase with 4 parallel agents (issue system, architecture, frontend UX, fluxaOS state)
- Established system philosophy: "machine, not solution" — fully agnostic to stages/providers/harnesses
- Created CLAUDE.md with 23 invariants, verification protocol, testing philosophy
- Documented orchestrator vs worker separation (systemd = brain, AI workers = dumb executors)
- Defined multi-tenancy model: org → user → project (GitHub-style)
- Approved DA-reviewed rich issue model spec + brainstorming addendum
- DA review found 35 issues, all incorporated into plan v2

### Implementation (15 tasks, all complete)
- **Phase 0:** Nuke script (FK-safe deletion order)
- **Phase 1:** Schema overhaul — 35 tables total, 15 new (user, 6 catalogs, comment, attachment, dependency, saved view, 3 git placeholders), issue table rebuilt with FK refs to catalogs, partial unique indexes for NULL projectId, JSONB labels with sql template default
- **Phase 2:** Seed script with full default dataset (org, user, project, pipeline, 5 types, 7 states, 5 statuses, 4 priorities, 1 label, 10 transitions, 5 config entries)
- **Phase 3:** 8 services rewritten/created (user, issue-catalog, issue, issue-comment, issue-attachment, issue-dependency, issue-event, issue-saved-view). 23 integration tests passing against real Supabase. FOR UPDATE locking for number allocation. Optimistic concurrency on all mutations.
- **Phase 4:** tRPC routers with nested sub-routers (issue.comment.*, issue.attachment.*, etc.). Catalog router with health check endpoint.
- **Phase 5:** Routes restructured to `/[org]/[user]/[project]/`. Dynamic root redirect from DB. All pages rewritten with catalog-driven dropdowns/badges. tRPC React Query provider added.
- **Phase 6:** Invariant verification passed. User one-thing test passed (create issue #1, edit title, change state, change priority, add comment, verify list).
- **UI fixes:** State change switched to dropdown, comment edit/delete added, activity log shows resolved display names.

### Key Commits (oldest to newest)
```
b183c3c feat(db): add nuke script
aac1b9d schema: add user table, add userId to project
e76fc2f schema: add issue catalog tables with partial unique indexes
cf116c7 schema: overhaul issue table, add entity tables, delete hardcoded enums
a04f8b8 seed: add user, issue catalogs, transitions, status automation config
d4c167e feat: user service
dcafdab feat: issue catalog service
55a80d0 feat: rewrite issue service — DB-driven transitions, FOR UPDATE numbering
d3dffe0 feat: comment service — soft-delete captures body in event
daaf01b-66a8f63 feat: attachment, dependency, event, saved view services
1feffd6 test: integration tests (23 passing)
84a06fc feat: rewrite issue router with nested sub-routers
bcfed39 feat: issue catalog router + config health check
2e551bd feat: restructure routes to /[org]/[user]/[project]/
c096191-9861f55 feat: issue list, detail, create pages + dashboard (catalog-driven)
c7c2e62 fix: issue detail — state dropdown, comment edit/delete, rich activity log
```

## What's Working
- Full issue CRUD (create, read, update, delete) via UI and API
- Per-project issue numbering (#1, #2, #3...)
- Database-driven catalogs: types, states, statuses, priorities, labels
- Database-driven state transitions (no hardcoded state machine)
- Optimistic concurrency (version field) on all mutations
- Comments: create, edit (with version check), soft-delete (with audit trail)
- Activity feed with event type resolution and display name lookups
- Nuke-and-seed cycle for clean development state
- 23 integration tests against real Supabase
- Multi-tenant URL structure: /[org]/[user]/[project]/...
- Dynamic root redirect (queries DB, no hardcoded slugs)

## What's Not Working / Known Issues
- **UI design needs CSS polish** — functional but not visually polished to the user's standards. All styling is Tailwind classes, fully independent from logic.
- **CatalogBadge component duplicated** across 3 client files — should be extracted to shared component
- **Zod v4 + tRPC v11 GET parameter parsing** — curl tests fail for parameterized endpoints. React client works fine. Pre-existing issue.
- **Pipeline pages** (list, detail) reference tRPC endpoints that don't exist yet (pipeline.listRunsByProject, etc.)
- **KPIs page** — placeholder, not functional
- **Settings pages** (personas, skills, routing, providers) — still reference old tRPC shapes, will need updates
- **"Just Do It" section** — placeholder UI, no-op submit. Future feature.
- **Attachments, dependencies, saved views** — services and API exist, UI panels not yet built on detail page
- **Labels** — catalog exists, UI multi-select not built
- **Search** — ilike filter exists in service, search input exists on list page, needs wiring verification

## What Comes Next

### Immediate Options (pick one)
1. **UI Polish Pass** — restyle all issue pages to match the glassmorphism design from PR #12. Extract shared components. Fix Settings pages.
2. **Phase R4: Gate Engine** — declarative rules engine that evaluates field/operator/value conditions. Config-driven, no hardcoded conditions. This is the next piece of the "heart" of the system.
3. **Phase R5: Pipeline Engine** — the orchestrator daemon. This is what makes issues actually flow through stages.

### Recommended Sequence
R4 (Gate Engine) → R5 (Pipeline Engine) → UI Polish → R6 (CLI + Journey Test + Ship)

The gate engine and pipeline engine are the remaining "heart" components. Without them, issues exist but don't flow. UI polish can happen in parallel or after.

## How to Start Next Session

```
Resume the fluxaOS rebuild. Read CLAUDE.md first (23 invariants), then read 
docs/superpowers/specs/2026-04-09-session-handoff-v2.md for current state. 
The rich issue model is complete and verified. Next: [user's choice of R4/R5/UI polish].
```

## Development Commands
```bash
npx tsx src/core/db/nuke.ts          # Clear all data
npx tsx src/core/db/seed.ts          # Seed defaults
npm run dev                           # Start dev server
npx vitest run src/__tests__/integration/services.test.ts  # Run integration tests (23 tests)
npx drizzle-kit push --force          # Push schema to Supabase
```

## Supabase Details
- Project ref: zesinfsluyxiwzldeffa
- Region: aws-1-us-west-2
- Credentials in `.env` (gitignored)
- 35 tables in public schema

## Process Rules (from CLAUDE.md, always apply)
1. No phase complete without human verification in browser
2. No autonomous architecture decisions — flag deviations
3. Integration tests hit real Supabase, not mocks
4. No unit tests — ever
5. No hardcoded enums — everything from DB
6. System is agnostic — engine doesn't know stage names, provider names, or harness names
7. AI workers are read-only executors — systemd orchestrator manages all state
8. Fail fast, no fallbacks, no hardcoded values
