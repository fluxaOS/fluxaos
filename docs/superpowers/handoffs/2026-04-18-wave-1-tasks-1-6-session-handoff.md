# Wave 1 Foundation — Session Handoff (Tasks 1-6 Shipped, 7-9 Pending)

**Date:** 2026-04-18
**Branch:** `feat/wave-1-foundation` → to be merged to `main` this session
**Plan:** `docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md`
**Prior mid-session handoff:** `docs/superpowers/handoffs/2026-04-17-wave-1-midsession-handoff.md` (kept in-tree as the task-6 scope-expansion record)

## Executive summary

Wave 1 of the post-audit remediation plan is **two-thirds shipped**. Tasks 1 through 6 (invariant amendment, standards-doc retirement, CRUD factory rewrite, dead-export sweep, dead-source-file purge) are committed on `feat/wave-1-foundation` and will be merged to `main` in this session via PR. Tasks 7 (schema drop + router cleanup), 8 (out-of-core relocations), and 9 (end-to-end verification) are deferred to a follow-up branch because they involve destructive database migrations and require browser verification under invariant 21.

Zero user-facing changes so far. Every commit on the branch is `tsc`-green (modulo one pre-existing error at `src/core/db/scripts/events.ts:53` that Task 8 is explicitly scoped to fix) and the vitest integration suite remains at **115 passed / 4 skipped / 0 failed** across 9 files.

## Branch state at HEAD

```
a64a24c docs(handoff): Wave 1 mid-session handoff after Tasks 1-6
d55f3d2 chore: delete dead source files (triage Pattern 5)
cdfad55 chore(pipelines/page): remove orphaned pipelinesQuery
81935a4 chore: delete unused exports (triage Pattern 5)
7f58d3c refactor(crud-factory): enforce updatedAt column at type level
72c46b3 feat(crud-factory): add versioned variant, remove 'as any' casts
5b34284 docs(ports/database): document intentional Drizzle-typed Database alias
861146d docs: retire ARCHITECTURAL_STANDARDS.md, invariants.md is sole source of truth
93d6d8d docs(invariants): amend §7 with core-stack vs pluggable-integration distinction
```

**Diff shape:** 29 files changed, 354 insertions, 3,144 deletions. Net **-2,790 LOC** from retiring `ARCHITECTURAL_STANDARDS.md` (1,611 lines across two copies) plus the Task 6 dead-source purge (~1,100 LOC) plus the unused-export sweep.

## Commit-by-commit shipped work

### `93d6d8d` — Task 1: amend invariant 7

**Why:** Phase 2 audit found invariant 7's prose banned `drizzle-orm` runtime imports in `src/core/`, while the verification script did not enforce that. 100+ live imports were either all legal or all illegal depending on which artifact was authoritative. User-led triage (audit-triage.md F-1, F-2) decided: Drizzle / Next.js / React / tRPC are "core stack" — lock-in is accepted. The adapter-registry pattern applies to **pluggable integrations** (AI providers, git hosts, auth backends, realtime transports) only.

**What:** Rewrote `docs/invariants.md` §7 to distinguish the two categories explicitly. Updated the verification script comment so the ban list is unambiguous. No code change — only invariants-as-contract change.

### `861146d` — Task 2: retire `ARCHITECTURAL_STANDARDS.md`

**Why:** Triage decision D-1. The standards doc predated invariants.md and had overlapping, sometimes-contradictory guidance. Sole source of truth is now invariants.md.

**What:** Deleted `ARCHITECTURAL_STANDARDS.md` and `.claude/ARCHITECTURAL_STANDARDS.md` (synced copy). Mapped all 14 still-valid rules to existing invariants (4, 9, 10, 11, 15, 16, 17) — no invariant content was lost. Removed CLAUDE.md + session-quick-start.md references.

### `5b34284` — Task 3: document intentional Drizzle typing at the Database port

**Why:** Triage decision D-2. Multiple auditors flagged `src/core/ports/database.ts` for exposing a Drizzle-typed alias. Triage decision: this is intentional — "core stack" makes type leakage acceptable here. Document it so future auditors don't re-flag.

**What:** Prepended a 12-line JSDoc explaining the intentional typing and pointing at the triage decision.

### `72c46b3` + `7f58d3c` — Task 4: rewrite the CRUD factory

**Why:** The old factory used `as any` casts and couldn't support optimistic concurrency (invariant 12). Wave 2 will migrate every versioned entity onto this factory, so it needs to land type-clean first.

**What:**
- `src/core/services/crud-factory.ts` fully rewritten with two factories:
  - `createCrudService` — basic list/getById/create/update/remove
  - `createVersionedCrudService` — adds `updateWithVersion` + `deleteWithVersion` with `and(eq(id), eq(version))` guard and `version: expectedVersion + 1` increment
- Type-level constraints (`WithIdColumn`, `WithVersionColumn`, `WithUpdatedAtColumn`) enforce the required columns at compile time — no runtime discovery.
- `as any` replaced with narrowed `as Record<string, unknown>` for Drizzle `.set()` / `.values()` payloads — tight enough to fail typing when the shape is wrong, loose enough to let Drizzle infer its own insertion type.
- New integration test `src/__tests__/integration/crud-factory.test.ts` (6 tests) uses `organization` (non-versioned) and `driver` (versioned) against real Supabase.
- `7f58d3c` is the follow-up for code-review item I-1: `updatedAt` is now type-enforced via `WithUpdatedAtColumn`.

**Signature change:** `CrudService.remove` widened from `Promise<void>` to `Promise<boolean>`. Backward compatible (boolean assignable where void return is ignored); full repo tsc + vitest re-run confirmed zero regressions.

### `81935a4` + `cdfad55` — Task 5: delete unused exports

**Why:** Triage Pattern 5 (audit-triage.md). Everything shipping with a consumer stays; dead exports go. Keeping them trains future agents to copy the wrong pattern (lessons-learned 12).

**What:** Removed `OUTPUT_FORMAT` / `OutputFormat` from `src/core/constants.ts`, `isRule` from `src/core/gates/types.ts` + `index.ts`, public `has()` from `src/config/registry.ts`, `trend` prop from `src/components/stat-card.tsx`, and `triggerRun` + `defaultPipeline` from `src/app/[org]/[user]/[project]/pipelines/page.tsx`.

**Pre-commit hook adjustment:** The pre-commit lint hook flagged a **pre-existing** `(run as any)` cast at `pipelines/page.tsx:104`. Fixed as part of the sweep — `pipelineName` is present on the tRPC-inferred return type at `src/server/routers/pipeline.ts:206`, so the cast was never needed.

**Follow-up sweep (`cdfad55`):** After removing `triggerRun` and `defaultPipeline`, the orphaned `pipelinesQuery` had no consumers. `noUnusedLocals` didn't catch it, so a separate sweep removed it.

### `d55f3d2` — Task 6: delete dead source files (scope expanded)

**Why:** Triage Pattern 5 — dead files from deferred features (Brand, Persona, Skills type shadows) and the dead parallel orchestrator path (AUDIT-006/022).

**What (deleted):**
- `src/core/services/{brand,issue-attachment,issue-dependency,issue-saved-view}.ts` (4 service files)
- `src/core/{pipeline,brands,personas,skills}/types.ts` (4 type-shadow files; `skills/` dir kept because `materializer.ts` lives there)
- `src/core/ports/{notification,storage}.ts` (2 deferred ports)
- `src/core/orchestrator/{index,stage-worker}.ts` (dead barrel + dead parallel-execution path)
- `src/__tests__/integration/orchestrator.test.ts` (was exercising the deleted stage-worker code)

**What (edited):** `src/core/services/index.ts` dropped 4 barrel re-exports; `src/core/ports/index.ts` dropped 2 port re-exports.

**Scope expansion (critical for future work):** `src/server/routers/issue.ts` had 3 live tRPC sub-routers (`attachment`, `dependency`, `savedView`) importing the three `issue-*` services. If Task 6 deleted the services without removing those sub-routers, tsc would break between commits 6 and 7. **Resolution:** pulled the 3 dead sub-router removals forward into Task 6 so every commit stays tsc-green. Task 7's Step 3 scope is correspondingly reduced (see below).

## Verification state at HEAD (`a64a24c`)

| Check | Result |
|-------|--------|
| `npx tsc --noEmit 2>&1 \| grep -v 'src/core/db/scripts/events.ts'` | **Clean** |
| `npx vitest run` | **115 passed / 4 skipped / 0 failed** across 9 files |
| `npm run lint` | Passes (pre-commit hook green on every commit) |
| Pre-existing error at `src/core/db/scripts/events.ts:53` | **Present** — missing `.where(...)` clause on a Drizzle select. Pre-existed on `main` at commit `6f406b3`. Deferred to Task 8 which relocates the file anyway. |

## Pending work — Tasks 7, 8, 9

### Task 7 — Drop dead schema tables + remaining router procedures

**Plan reference:** `docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md` lines 680-778.

**Scope (with Task 6 carryover noted):**
- Create `drizzle/0006_drop_dead_tables.sql` dropping `issue_attachment`, `issue_dependency`, `issue_saved_view` (CASCADE).
- Remove the 3 `pgTable(...)` declarations from `src/core/db/schema.ts` plus any `relations(...)` blocks and any FK references.
- Remove the **remaining** dead procedures from `src/server/routers/issue.ts`: `stateOverride`, `close`, `reopen`, `users` (the `db.execute(sql\`SELECT DISTINCT val ...\`)` one). Drop any dynamic `import('drizzle-orm')` inside those procedures.
- **Leave the sub-router imports alone** — the 3 dead ones (`attachment`, `dependency`, `savedView`) were already removed in Task 6.
- Clean any seed data referencing the dropped tables: `grep -rn "issueAttachment\|issueDependency\|issueSavedView" src/scripts/db/ src/core/db/` (paths depend on whether Task 8 ran first).
- Apply the migration: `npx drizzle-kit migrate`.
- Run `tsx src/core/db/nuke.ts && npm run db:seed && npm run verify` to confirm end-to-end.
- Commit with the plan's exact message.

### Task 8 — Relocate out-of-core files

**Plan reference:** `docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md` lines 782-896.

**Scope (use `git mv` for history):**
- `src/core/orchestrator/demo.ts` → `src/scripts/orchestrator-demo.ts`
- `src/core/gates/demo.ts` → `src/scripts/gates-demo.ts`
- `src/core/db/scripts/*` → `src/scripts/db/*` (connection, issues, runs, gates, events)
- `src/core/db/seed.ts` → `src/scripts/db/seed.ts`
- `src/core/db/nuke.ts` → `src/scripts/db/nuke.ts`
- Verification helpers if present → `src/scripts/verify/`

**Also fix during relocation:** the pre-existing tsc error at the moved `src/scripts/db/events.ts:53` — the Drizzle select is missing a `.where(...)` terminal. Read the file, add the right clause, and confirm full `npx tsc --noEmit` is zero errors.

**Also update:** `package.json` scripts (`db:issues`, `db:runs`, `db:gates`, `db:events`, `verify`, etc.) + any `CLAUDE.md` references.

### Task 9 — Re-run Wave 1 verification end-to-end

**Plan reference:** `docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md` lines 900-996.

- Clean install: `rm -rf node_modules && npm i`.
- `npx tsc --noEmit` — expect **fully clean** now that Task 8 fixed events.ts.
- `npm run lint`.
- `npx vitest run` — expect 115+ passes, 0 failures.
- `tsx src/scripts/db/nuke.ts && npm run db:seed && npm run verify` — expect **10/10** verify checks.
- `npm run db:issues`, `db:runs`, `db:gates`, `db:events` — confirm expected shapes.
- Run the three mechanical invariant checks from `docs/invariants.md` § Verification Script.
- **Browser verification (user-required, invariant 21):** start dev server, confirm homepage / settings / issue-detail / create-issue all load with no console errors and no regressions. No self-certification.

## Human UI tests required

This branch is **docs-only + type-system-only + dead-code removal**. There are no runtime behavior changes shipping in this PR. That said, because Task 4 rewrote the CRUD factory signature and Task 6 deleted a dead test file, a lightweight smoke pass is prudent:

1. `npm run dev` — homepage loads at `http://192.168.54.101:3003` without console errors.
2. Navigate to **Settings → Drivers** — list loads, create/edit/delete still work (they don't use the factory yet, but this is the area Wave 2 will migrate onto the factory).
3. Navigate to **Issues → list** — both seed issues render (IDs + titles).
4. Open one issue detail — comments/events render.
5. Open **Pipelines** page — confirms the `triggerRun` removal didn't break layout (no broken button, no red error block).

Anything beyond that is out of scope for Wave 1 and will be re-verified end-to-end in Task 9 after schema + relocation work.

## Roadmap update (this session)

- `R-REM-W1` status flips from **Plan ready** to **In flight — Tasks 1-6 shipped, 7-9 pending** in `docs/superpowers/roadmap.md`.
- The wave will be marked **Done** only after Task 9's browser verification passes.

## Known loose ends (out of Wave 1 scope)

Carrying forward from the mid-session handoff — none of these block Wave 2 planning:

1. **Downstream docs still carry old "zero vendor imports" wording** — `CLAUDE.md:49`, `README.md:86`, rebuild-spec, spec-v2, r-ui-2-design, etc. Task 1 code reviewer flagged as Minor. Sweep as a trailing doc-polish commit on a future branch or defer to doc-drift housekeeping.
2. **Code-audit skill templates reference the retired `ARCHITECTURAL_STANDARDS.md`** — `.claude/skills/code-audit/SKILL.md`, `.agents/skills/code-audit/...`, and the upstream `fh-commons/templates/...`. Runtime impact only if the skill runs. Fix at source or accept as post-Wave-1 housekeeping.
3. **`src/core/pipeline/.gitkeep`** — untracked empty-dir marker left behind when `pipeline/types.ts` was deleted. Harmless but tidy up if noticed.
4. **Minor improvements deferred by code reviewers that did not block:**
   - Task 4 M-1: document why `version: expectedVersion + 1` is safe (one-line comment in crud-factory).
   - Task 4 M-4: future factory may need `count` / `exists` methods — Wave 2's entity migrations will surface the need.

## How to resume for Tasks 7-9

1. Start a fresh session.
2. Read this handoff top-to-bottom.
3. Create a new branch: `git checkout -b feat/wave-1-finish` off the freshly-merged `main`.
4. Invoke `superpowers:subagent-driven-development` and proceed with Task 7, then 8, then 9.
5. Reference the plan at `docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md` lines 680-996.
6. For Task 9's browser verification, the user must confirm — no self-certification per invariant 21.
7. On completion, use `superpowers:finishing-a-development-branch` to ship a second PR and flip `R-REM-W1` to **Done** in the roadmap.

## Why this is being merged in two PRs instead of one

- **This PR (Tasks 1-6):** docs-only + type-system-only + dead-code deletion. Zero runtime impact. Safe to merge without browser verification. Mergeable now. Unblocks Wave 2 planning conversations that rely on the amended invariant 7 and the new CRUD factory.
- **Next PR (Tasks 7-9):** schema migration + file relocations + end-to-end verification. Needs browser confirmation under invariant 21 and a fresh context window for the migration work.

Splitting lands the safe foundation quickly and keeps the destructive DB work gated behind explicit human verification.
