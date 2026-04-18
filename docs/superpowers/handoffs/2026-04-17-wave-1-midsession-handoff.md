# Wave 1 Foundation — Mid-session Handoff (Tasks 1-6 Landed)

**Date:** 2026-04-17
**Branch:** `feat/wave-1-foundation` (8 commits, 0 merge-conflicts-with-main expected)
**Plan:** `docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md`
**Reason for pause:** Context budget. Tasks 1-6 complete and verified; Tasks 7-9 (schema migration, file relocations, end-to-end verification) deserve a fresh context window.

## What shipped on this branch

| SHA | Task | Summary |
|-----|------|---------|
| `93d6d8d` | 1 | docs(invariants): amend §7 with core-stack vs pluggable-integration distinction |
| `861146d` | 2 | docs: retire ARCHITECTURAL_STANDARDS.md, invariants.md is sole source of truth |
| `5b34284` | 3 | docs(ports/database): document intentional Drizzle-typed Database alias |
| `72c46b3` | 4 | feat(crud-factory): add versioned variant, remove 'as any' casts |
| `7f58d3c` | 4 (follow-up) | refactor(crud-factory): enforce updatedAt column at type level (code-review fix) |
| `81935a4` | 5 | chore: delete unused exports (triage Pattern 5) |
| `cdfad55` | 5 (sweep) | chore(pipelines/page): remove orphaned pipelinesQuery |
| `d55f3d2` | 6 | chore: delete dead source files — **scope expanded** to include 3 dead issue sub-routers (see below) |

## Important: Task 6 scope expansion

The plan's Task 7 Step 3 originally included removing the `attachment`, `dependency`, `savedView` sub-routers from `src/server/routers/issue.ts`. However, if Task 6 deleted the three `issue-*` service files without also removing the sub-routers that import them, tsc would break between commits 6 and 7.

**Resolution (in `d55f3d2`):** pulled those three sub-router removals forward into Task 6 so every commit stays tsc-green.

**Impact on Task 7:** Its Step 3 now only needs to remove the remaining dead procedures:
- `stateOverride` procedure
- `close` procedure
- `reopen` procedure
- `users` procedure (the `db.execute(sql\`SELECT DISTINCT val ...\`)` one)
- Any dynamic `import('drizzle-orm')` inside the deleted procedures

Leave the sub-router imports alone — the 3 dead ones are already gone.

## Verification state at HEAD (d55f3d2)

- `npx tsc --noEmit 2>&1 | grep -v 'src/core/db/scripts/events.ts'` → **clean**
- `npx vitest run` → **115 passed / 4 skipped / 0 failed** across 9 files
- Pre-existing tsc error at `src/core/db/scripts/events.ts:53` (missing `where` in a Drizzle select) — **not ours**, was broken on main before this branch. Task 8 relocates this file; whoever handles Task 8 should also fix this query before Task 9's `npx tsc --noEmit` gate.

## Wave 1 tasks remaining

### Task 7 — Drop dead schema tables + router procedures

**Plan reference:** `docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md` lines 680-778.

Scope (with Task 6 carryover noted):
- Create `drizzle/0006_drop_dead_tables.sql` dropping `issue_attachment`, `issue_dependency`, `issue_saved_view` (with CASCADE).
- Remove the 3 table declarations from `src/core/db/schema.ts`, plus any `relations(...)` blocks and any FK references.
- Remove the remaining dead procedures from `src/server/routers/issue.ts`: `stateOverride`, `close`, `reopen`, `users` (attachment/dependency/savedView already gone).
- Drop any imports that become unused after removing those procedures.
- Clean any seed data referencing the dropped tables: `grep -rn "issueAttachment\|issueDependency\|issueSavedView" src/scripts/db/ src/core/db/` (paths depend on whether Task 8 ran first).
- Apply the migration: `npx drizzle-kit migrate`.
- Run `tsx src/core/db/nuke.ts && npm run db:seed && npm run verify` to confirm end-to-end.
- Commit with the plan's exact message.

### Task 8 — Relocate out-of-core files

**Plan reference:** `docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md` lines 782-896.

Move files from `src/core/` to new `src/scripts/` tree:
- `src/core/orchestrator/demo.ts` → `src/scripts/orchestrator-demo.ts`
- `src/core/gates/demo.ts` → `src/scripts/gates-demo.ts`
- `src/core/db/scripts/*` → `src/scripts/db/*` (connection, issues, runs, gates, events)
- `src/core/db/seed.ts` → `src/scripts/db/seed.ts`
- `src/core/db/nuke.ts` → `src/scripts/db/nuke.ts`
- Verify-test helpers (if `src/core/__tests__/verify/` or similar exists): → `src/scripts/verify/`

Use `git mv` for history preservation.

Fix imports inside moved files (the `@/` aliases mostly still resolve but relative imports break). Update `package.json` scripts and any `CLAUDE.md` references.

**Also fix:** the pre-existing tsc error at `src/core/db/scripts/events.ts:53` (now at `src/scripts/db/events.ts:53` post-move). The query is missing a `.where(...)` terminal — likely a `where(...)` clause got dropped during an earlier refactor. Read the file and add the right clause so `npx tsc --noEmit` is finally fully green.

### Task 9 — End-to-end verification

**Plan reference:** `docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md` lines 900-996.

- Clean install, tsc (must be zero errors after Task 8's events.ts fix), lint, full vitest run.
- `tsx src/scripts/db/nuke.ts && npm run db:seed && npm run verify` (10/10 expected).
- `npm run db:issues`, `db:runs`, `db:gates`, `db:events` — confirm output shape.
- Run the three mechanical invariant checks from `docs/invariants.md` § Verification Script.
- Browser verification: start dev server, confirm homepage/settings/issue-detail/create-issue work with no console errors.
- **User must browser-confirm** — no self-certification per invariant 21.

## Known loose ends (out of Wave 1 scope, worth tracking)

1. **Downstream docs still carry old "zero vendor imports" wording** — `CLAUDE.md:49`, `README.md:86`, rebuild-spec, spec-v2, r-ui-2-design, etc. Flagged by Task 1 code reviewer as Minor. Sweep as a trailing doc-polish commit on this branch OR defer to a dedicated doc-drift task.
2. **Code-audit skill templates reference retired `ARCHITECTURAL_STANDARDS.md`** — `.claude/skills/code-audit/SKILL.md`, `.agents/skills/code-audit/...`, and the upstream `fh-commons/templates/...`. Runtime impact only if the skill runs. Fix at source or accept as post-Wave-1 housekeeping.
3. **`src/core/pipeline/.gitkeep`** — untracked file left behind when `pipeline/types.ts` was deleted in Task 6. Harmless but tidy up if noticed.
4. **Minor improvements deferred** by code reviewers that did not block:
   - Task 4 M-1: document why `version: expectedVersion + 1` is safe (one-line comment in crud-factory).
   - Task 4 M-4: future factory may need `count` / `exists` methods — Wave 2's entity migrations will surface the need.

## How to pick up

1. Read this handoff and the Wave 1 plan.
2. `git checkout feat/wave-1-foundation && git log --oneline main..HEAD` to confirm state.
3. Invoke `superpowers:subagent-driven-development` and proceed with Task 7.
4. After Task 9 passes, use `superpowers:finishing-a-development-branch` to prep a PR.
