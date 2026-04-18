# Wave 1 Foundation — Finish Session Handoff (Tasks 7-9 Shipped, Browser Verified, Awaiting PR)

**Date:** 2026-04-18
**Branch:** `feat/wave-1-finish` (3 commits ahead of `main`)
**Plan:** `docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md` (Tasks 7-9 at lines 680-996)
**Prior handoff:** `docs/superpowers/handoffs/2026-04-18-wave-1-tasks-1-6-session-handoff.md`

## Status

Wave 1 is **fully implemented and verified**. Tasks 7, 8, 9 all passed spec compliance + code quality review + end-to-end verification + browser confirmation (user-confirmed under invariant 21). The only remaining work is wrapping the PR and flipping the roadmap status to Done.

## What shipped on this branch

```
84c2f41 docs(deferred-fixes): update DEF-007 exemption path after Task 8 relocation
eae7fef chore: relocate out-of-core files to src/scripts/
185e86e feat(schema): drop issue_attachment, issue_dependency, issue_saved_view
```

### `185e86e` — Task 7: drop dead schema tables + router procedures

- New: `drizzle/0006_drop_dead_tables.sql` (hand-written, 3× `DROP TABLE IF EXISTS ... CASCADE`).
- `drizzle/meta/_journal.json` idx-4 entry added.
- `src/core/db/schema.ts`: removed 3 `pgTable` declarations (`issueAttachment`, `issueDependency`, `issueSavedView`), their 3 `relations(...)` blocks, the `attachments: many(issueAttachment)` line on `issueRelations`. −98 lines (1076 → 978).
- `src/server/routers/issue.ts`: removed 4 dead procedures (`stateOverride`, `close`, `reopen`, `users`). Sub-routers were already gone in Task 6.
- `src/core/db/nuke.ts`: removed 3 dropped-table entries from the FK-safe deletion array.
- `src/__tests__/integration/services.test.ts`: removed 3 dead `tableMap` entries (mechanical — refs no longer existed on `schema.*`).
- `docs/superpowers/deferred-fixes.md`: added DEF-008 entry logging the pre-existing `services.test.ts` hook violations (6× `no-explicit-any` + 561 lines > 500-line cap, both present on `main` before Wave 1, last touched in SHA `1feffd6`).
- Service methods `stateOverride`/`close`/`reopen` in `src/core/services/issue.ts` were intentionally preserved — `services.test.ts:425/434` still exercises them.
- Commit used `--no-verify` (user-authorized) because re-staging `services.test.ts` caused the pre-commit hook to re-audit a file that was already non-compliant on `main`.

### `eae7fef` — Task 8: relocate out-of-core files + fix pre-existing tsc error

- 9 `git mv` renames (history preserved, verified via `git log --follow`):
  - `src/core/orchestrator/demo.ts` → `src/scripts/orchestrator-demo.ts`
  - `src/core/gates/demo.ts` → `src/scripts/gates-demo.ts`
  - `src/core/db/scripts/{connection,issues,runs,gates,events}.ts` → `src/scripts/db/{...}.ts`
  - `src/core/db/{seed,nuke}.ts` → `src/scripts/db/{seed,nuke}.ts`
- **Pre-existing tsc error at (old) `events.ts:53` fixed during the move.** The old `let query = A; if (mode === 'run') query = B; await query;` pattern produced two different `PgSelectBase` subtypes; restructured to `const rows = mode === 'run' ? await <run-branch> : await <recent-branch>`. Semantics preserved: `run` branch filters by `event.stageRunId` with no `.limit`; `recent` branch has no `where` and keeps `.limit(50)`.
- `package.json`: 5 `db:*` script paths updated.
- `CLAUDE.md`: 2 `nuke.ts` path references updated.
- `src/app/page.tsx`: 3 user-facing help strings updated.
- `tests/verify/seed-check.ts`: 1 import of the moved `@/scripts/db/connection` helper updated.
- 6 internal relative imports inside moved files switched to `@/`-absolute paths so moves are self-contained.
- Absorbed Task 7 reviewer's JSDoc nit: `src/server/routers/issue.ts:4` example `issue.attachment.create` → `issue.event.list`.
- `tests/verify/` (run-all.ts + seed-check.ts) left in place — they were already outside `src/core/`. Plan's reference to `src/core/__tests__/verify/` was stale.
- **Not moved** (deliberate): `src/core/db/connection.ts` is the DI-friendly app-stack factory; `src/scripts/db/connection.ts` is a separate script-only helper. Different consumers, different responsibilities.

### `84c2f41` — docs path follow-up

One-line update to `docs/superpowers/deferred-fixes.md:158` — the DEF-007 exemption note referenced the now-moved `src/core/db/seed.ts`. Also updated the *local* `.git/hooks/pre-commit:40` SIZE_EXEMPT entry from the old path to `src/scripts/db/seed.ts` (hook is untracked, local-clone-only; fresh clones will need to re-add until DEF-007 lands).

## Verification state at HEAD (`84c2f41`)

| Check | Result |
|-------|--------|
| `rm -rf node_modules && npm install` | Clean. |
| `npx tsc --noEmit` | **Zero errors** (events.ts fix verified — was the only pre-Wave-1 error). |
| `npm run lint` | 3163 problems, **identical count to `main`** — zero new violations introduced by Wave 1. |
| `npx vitest run` | **115/115 pass** across 9 files. |
| `npx tsx src/scripts/db/nuke.ts && npm run db:seed && npm run verify` | **10/10 PASS.** |
| `npm run db:issues` | Prints 2 issues (#1, #2). |
| `npm run db:runs / db:gates / db:events` | Each prints expected "No X found" empty state. |
| Stage-name invariant check | PASS. |
| Vendor-import-in-core invariant check | PASS (the orchestrator/gates/db relocations landed the adapter-instantiation violations). |
| File-size invariant check | Same warnings as pre-Wave-1 (`client.tsx` 880, `services.test.ts` 561, `gates.test.ts` 702, `scripts/db/seed.ts` 587, `schema.ts` 978, `services/issue.ts` 685). `orchestrator.test.ts` dropped off the list (Task 6 deleted it). `schema.ts` shrank by 98 lines (Task 7). |
| Browser verification (invariant 21) | **User-confirmed ✅** — homepage, settings/drivers, settings/skills, issue detail, issue create, no console errors. Dev server ran at `http://192.168.54.101:3001`. |

## What's left — 3 steps

### 1. Wrap the branch and open the PR

Use `superpowers:finishing-a-development-branch` to do the pre-PR checks (it will re-run tsc/vitest — all should still be green) and open the PR with `gh pr create`.

**Suggested PR title:**
```
feat(wave-1): drop dead schema, relocate out-of-core scripts, finish Wave 1 foundation
```

**Suggested PR body** (edit to taste):
```
## Summary
- Drops `issue_attachment`, `issue_dependency`, `issue_saved_view` tables (migration 0006) + their router procedures — dead-feature cleanup from audit triage C1.
- Relocates demo / db-script / seed / nuke helpers from `src/core/` to `src/scripts/` per invariant 7's pluggable-integration rule. `git mv` used throughout — history preserved.
- Fixes the pre-existing `events.ts` tsc error (missing `.where` on a branched Drizzle select) during the relocation. `npx tsc --noEmit` is now fully clean.
- Logs two pre-existing `services.test.ts` hook violations as DEF-008 (both predate Wave 1; committed with --no-verify under explicit authorization — documented in the commit body).

Completes Wave 1 Foundation. Tasks 1-6 shipped in PR #37; this PR ships Tasks 7-9.

## Test plan
- [x] `npx tsc --noEmit` — zero errors
- [x] `npx vitest run` — 115/115 pass
- [x] `npx tsx src/scripts/db/nuke.ts && npm run db:seed && npm run verify` — 10/10 PASS
- [x] All four `db:*` scripts run cleanly
- [x] Stage-name / vendor-import / file-size invariant checks all pass
- [x] Browser verification (invariant 21) — user-confirmed
```

### 2. Merge to main

Once the PR is green and you've confirmed, merge it (squash or merge-commit — project has been using merge commits per recent history).

### 3. Flip the roadmap status

After merge, update `docs/superpowers/roadmap.md`:
- Find the `R-REM-W1` phase (status should currently read "In flight — Tasks 1-6 shipped, 7-9 pending" or similar from PR #37's docs update).
- Flip to **Done** in both the phases table and the "What's Next" section.
- Commit directly to main with a short docs message (no PR needed for roadmap status flips).

## Loose ends (not blocking, documented)

Carried forward from the mid-session handoff (out of Wave 1 scope, no action needed to merge this PR):

1. **Downstream docs with old "zero vendor imports" wording** — `CLAUDE.md:49`, `README.md:86`, rebuild-spec, spec-v2, r-ui-2-design. Sweep as trailing doc-polish on a future branch.
2. **Code-audit skill templates reference retired `ARCHITECTURAL_STANDARDS.md`** — fix at upstream `fh-commons/templates/...` or accept.
3. **`src/core/pipeline/.gitkeep`** — untracked empty-dir marker from Task 6. Harmless.
4. **Task 4 deferred code-review notes** — M-1 (one-line comment on `version: expectedVersion + 1` safety) and M-4 (future factory may need `count`/`exists`) — Wave 2 will surface the need.
5. **Task 8 reviewer nit M2** — `src/scripts/db/{seed,nuke}.ts` don't use the shared `@/scripts/db/connection` helper like the query scripts do (they instantiate `SupabaseDatabaseProvider` directly). Minor readability inconsistency now that they're all siblings. Optional polish for a future pass.
6. **DEF-008** (new, logged in this session) — `services.test.ts` has 6 pre-existing `no-explicit-any` errors and is 561 lines (> 500-line hook cap). See `docs/superpowers/deferred-fixes.md` for remediation options.

## Why a fresh session to finish

The implementation session ran Tasks 7-9 through two full subagent-driven-development loops (implementer → spec review → code-quality review) per task, plus full Task 9 verification. By the time browser-confirm came back ✅, context was at 90%. Rather than risk running out mid-PR, this handoff lets a fresh session walk into a clean, fully-verified branch and ship the PR cleanly.

## Resume instructions

1. Read this handoff top-to-bottom.
2. Confirm branch state: `git log main..feat/wave-1-finish --oneline` should show exactly the three commits listed above.
3. Invoke `superpowers:finishing-a-development-branch` and walk through the PR-creation workflow.
4. After merge, flip R-REM-W1 to Done in `docs/superpowers/roadmap.md` as described above.
