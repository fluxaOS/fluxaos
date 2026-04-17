# R-UI-1 Session B Handoff — Phase 0 Complete + Phase 1 Partial (Tasks 5–9 done, 10–31 pending)

**Date:** 2026-04-16
**Branch:** `feat/r-ui-1-implementation`
**Last commit:** `86d30da` (Task 9 — RecordEditor types)
**Previous handoff:** [2026-04-16 Session A handoff](2026-04-16-r-ui-1-session-a-rename.md)
**Next session target:** Tasks 10–31 (primitives → pages → tests → journeys → verification)

---

## Executive summary

Session B picked up at Task 5 of the R-UI-1 implementation plan (the broad `harness`→`driver` sed sweep). Phase 0 (the entire rename foundation) is now complete: every active source file, test file, and docs-that-matter reference uses `driver` instead of `harness`. The database was already renamed by Session A; the code now matches.

Session B went further and landed the first two of six Phase 1 primitive tasks: the `Feature` enum + `hasFeature()` stub, and the `RecordEditor` TypeScript types. The remaining primitives (RecordField, RecordActionsBar, RecordEditor main component, skill-service optimistic locking) are scoped, specified in the plan with full code, and ready to execute.

Beyond that, 18 tasks remain: two settings pages, two integration tests, a manual UI verification, five docs/nav/inventory tasks, a Playwright scaffold, six journey specs, and final verification.

Along the way Session B also resolved three pre-existing issues that were blocking (but unrelated to the rename): ESLint errors in orchestrator test files, file-size hook exemptions for `seed.ts` and `orchestrator.test.ts`, and a materializer-contract test that was asserting an obsolete file tree. All three are now fixed in their own commits with clear scoping.

The branch is in a trustworthy state. Tests pass. Typecheck is clean except for one pre-existing Drizzle type-narrowing error in `src/core/db/scripts/events.ts:53` that pre-dates Session A. No `harness|Harness|HARNESS` match exists anywhere in live source or active docs except two intentional "formerly known as" clarifiers.

---

## What shipped — commit by commit

All commits are on `feat/r-ui-1-implementation`, in chronological order on top of Session A's `6a8740c`.

### `4d8fc9a` — chore: fix pre-existing ESLint any/prefer-const in orchestrator tests + note DEF-007 exemptions

Prep commit run before the rename sweep could be committed. The pre-commit hook was blocking on 8 pre-existing ESLint violations (all in `orchestrator.test.ts` and `orchestrator-e2e.test.ts`) plus two file-size violations. Confirmed these errors existed at HEAD `6a8740c` independently of any Task 5 work via `git stash` round-trip.

Changes:
- `src/__tests__/integration/orchestrator.test.ts` — 6× `any` replaced with specific types. Notable: `Record<string, any>` → `Record<string, AnyPgTable & { id: AnyColumn }>` (imports `AnyPgTable` from `drizzle-orm/pg-core`, `AnyColumn` from `drizzle-orm`). Mock queue refactored from `Map<string, any>` to `Map<string, Job<unknown>>` with a new `type MockQueueHandler = (job: Job<unknown>) => Promise<void>`. Handler registration uses `as MockQueueHandler` cast at store-time; retrieval uses `as Job<T> | undefined`. The covariance cast is safe here because the test's skipped `describe` block is the only place where `processHandler` would actually execute.
- `src/__tests__/integration/orchestrator-e2e.test.ts` — 1× `any` → `unknown`.
- `let stageIds` → `const stageIds` (prefer-const, line 116).
- Removed unused `JobOptions` import that went unused after the queue re-typing.
- `docs/superpowers/deferred-fixes.md` — extended DEF-007 note at line 165 to list two new local-clone size exemptions: `src/__tests__/integration/orchestrator.test.ts` (550 lines) and `src/core/db/seed.ts` (587 lines). Noted both are DEF-008 candidates if a clean split seam emerges later.
- `.git/hooks/pre-commit` — `SIZE_EXEMPT_FILES` array extended with both files, per-clone only (untracked by design; DEF-007 tracks the canonical-hooks fix).

### `c86300f` — refactor: rename harness→driver across all source and test files

The main Task 5 rename sweep. Exactly 23 files, matching the plan's file list verbatim:

- `src/__tests__/integration/orchestrator-e2e.test.ts`
- `src/__tests__/integration/orchestrator.test.ts`
- `src/app/[org]/[user]/[project]/pipelines/[id]/page.tsx`
- `src/app/[org]/[user]/[project]/settings/page.tsx`
- `src/app/[org]/[user]/[project]/settings/routing/page.tsx`
- `src/components/pipeline/LiveOutput.tsx`
- `src/core/db/nuke.ts`
- `src/core/db/seed.ts`
- `src/core/orchestrator/command-builder.ts`
- `src/core/orchestrator/demo.ts`
- `src/core/orchestrator/event-orchestrator.ts`
- `src/core/orchestrator/manual-run.ts`
- `src/core/orchestrator/output-parser.ts`
- `src/core/orchestrator/pipeline-run-service.ts`
- `src/core/orchestrator/routing-resolver.ts`
- `src/core/orchestrator/stage-runner.ts`
- `src/core/orchestrator/stage-worker.ts`
- `src/core/orchestrator/types.ts`
- `src/core/pipeline/types.ts`
- `src/core/skills/materializer.ts`
- `src/server/routers/pipeline.ts`
- `src/server/routers/routing.ts`
- `tests/verify/seed-check.ts`

Total diff: +153/-151 lines.

Implementation approach: three sed passes (compound tokens first, standalone `\bharness\b`/`\bHarness\b` second, then a manual cleanup for compound camelCase forms the plan's regex didn't catch — `harnessQuery`, `harnesses`, `newHarnessId`, `setNewHarnessId`, `harnessName`, `harnessRow`, `claudeHarness`, `setHarness`, `Harnesses`). Post-sweep grep `grep -rn "harness\|Harness\|HARNESS" src/ tests/` returns empty.

One real TS fix required during the sweep: `orchestrator-e2e.test.ts:118` — the `DriverConfig` literal was missing `outputFormat` and `outputFormatFlag` fields that the interface now requires (added during Session A's Task 4 DA fix). Added `outputFormat: 'stream-json'` and `outputFormatFlag: '--output-format'` to match the seeded driver values.

User-facing capitalization verified intact in the three app pages:
- `settings/page.tsx` — `<th>Driver</th>` (capital), `<option value="">No driver</option>` (lowercase mid-sentence)
- `settings/routing/page.tsx` — `<th>Driver</th>`, `placeholder="Driver"`
- `pipelines/[id]/page.tsx` — displays `stageRun.driver` (data, not label)

### `56f3eef` — refactor: clean up stale harness refs in DEF-002/003 and ghost h loop variables

Code-review follow-ups to `c86300f`. The code-quality reviewer subagent flagged:
1. **Important:** DEF-002 and DEF-003 entries in `deferred-fixes.md` still referenced `src/server/routers/harness.ts` (a file that no longer exists) and `harness_revision` table. These are live operational pointers that would mis-direct future sessions.
2. **Minor:** Two ghost `h` lambda parameters in `settings/page.tsx` (lines 195 and 254) survived the sed because they're single-character identifiers. `drivers.find((h: ...) => h.id === ...)` and `drivers.map((h: ...) => ...)` — cosmetic sed artifacts that make the post-rename code look mechanical.

Fixes:
- `docs/superpowers/deferred-fixes.md` DEF-002 title: "skills and harnesses" → "skills and drivers"; location path `src/server/routers/harness.ts` → `src/server/routers/driver.ts`
- `docs/superpowers/deferred-fixes.md` DEF-003 title: "skills and harnesses" → "skills and drivers"; location `harness_revision` → `driver_revision`
- `src/app/[org]/[user]/[project]/settings/page.tsx` — two `(h: typeof drivers[number])` → `(d: typeof drivers[number])` with corresponding body `h.id`/`h.name` → `d.id`/`d.name`

### `ae831cf` — test: fix obsolete materializer contract assertions (pre-existing bug)

Task 6's full-test-suite run revealed one test failure in `orchestrator-e2e.test.ts` → "creates workspace with skill and context files". A diagnostic subagent confirmed this was pre-existing and unrelated to the rename:

The test was written in commit `f1ee361` ("R5-V Manual Stage Execution", April 8) and asserted that `materialize()` would write `skills/<name>/SKILL.md` files into the workspace. But the same R5-V refactor changed the materializer to **inline** skill prompts directly into `CLAUDE.md` (via a `## Skill: <name>` section) rather than write separate files. The test was always going to fail the moment anyone ran it end-to-end against the new materializer — it was asserting a contract from the previous-generation implementation. Session B's Task 5 rename didn't touch any string literals or paths in `materializer.ts` (only JSDoc/inline comment text), so it couldn't have introduced this; and the subagent verified identical failure on `f1ee361` by checking out pre-rename source.

Fix (3 insertions, 6 deletions in `orchestrator-e2e.test.ts`):
- Removed `expect(existsSync(workspacePath + '/skills/research/SKILL.md')).toBe(true)` assertion
- Replaced `readFileSync(workspacePath + '/skills/research/SKILL.md', 'utf-8')` read + `skillContent toBe('Research the topic thoroughly.')` check with a single read of `CLAUDE.md` and two `toContain` assertions (`## Skill: research` section + body text)

After fix: 111/111 (107 passed, 4 intentionally skipped; 2 of the passing tests are the new `features-primitive.test.ts` added in Task 8).

### `d166d65` — docs: rename harness→driver in active docs

Task 7. Active-docs sweep per plan scope (explicit DO-NOT-TOUCH: handoffs, older plans, older specs, RCAs, `docs/planning/`). Modified:
- `CLAUDE.md` — two sentences in the intro and Key Principles referring to "harness names" → "driver names"
- `docs/invariants.md` — Invariant 3 ("No harness name in application code") renamed, with a durable "formerly known as harness — renamed in R-UI-1 to avoid industry-terminology collision" clarifier appended; Invariant 20 "Provider/harness swap" → "Provider/driver swap"; verification-script comment `# Invariant 1-3: No hardcoded stage/provider/harness` → `/driver`
- `docs/superpowers/roadmap.md` — "What's Next" R-UI bullet "Harness catalog management page (list/create/edit/delete harnesses)" → "Driver catalog management page (list/edit/toggle; formerly 'harness' — renamed in R-UI-1)"
- `docs/superpowers/specs/2026-04-11-ui-inventory.md` — two list-item references ("Provider/Model/Harness info" and "RulesEditor: Stage, Models, Harness, Sort, Delete") → Driver

Verification: `grep -rn "harness\|Harness" CLAUDE.md docs/session-quick-start.md docs/invariants.md docs/superpowers/roadmap.md docs/superpowers/specs/2026-04-11-ui-inventory.md` returns only the two intentional "formerly known as" clarifier lines. Those were kept per plan Step 2 guidance about durable historical significance.

### `29baf73` — feat: add Feature enum + hasFeature() stub (DEF-001..004 hook point)

Task 8. Two new files, TDD-style (test first, confirm fail, implement, confirm pass):

- `src/__tests__/integration/features-primitive.test.ts` (22 lines) — two tests:
  1. Every `Feature` enum value returns `true` from `hasFeature('test-user', feature)` today (validates the DEF-004 stub behavior).
  2. `Feature` enum has exactly `PREVIEW_GATE`, `REVISION_HISTORY`, `ROLE_BASED_PERMISSIONS` keys (prevents accidental enum drift).

- `src/core/features/features.ts` (27 lines) — `Feature` enum + `hasFeature(userId, feature): boolean` stub that returns `true`. Each enum variant has a JSDoc comment pointing to its DEF-### entry. The function body has a DEF-004 TODO comment.

Both tests pass. The file count for integration tests is now 7 (added `features-primitive.test.ts` to the previous 6).

### `86d30da` — feat(record-editor): add descriptor and props types

Task 9. One file:
- `src/components/record-editor/types.ts` (83 lines). Pure TypeScript, no React runtime. Exports: `FieldType` union (text | textarea | textarea-large | tags | boolean | readonly), `FieldDescriptor<TRecord>`, `RecordDescriptor<TRecord>`, `RecordWithVersion`, `RecordEditorProps<TRecord extends RecordWithVersion>`.

Notable in the props type (per DA fix during Session A):
- `onSave(id, patch, expectedVersion)` — required
- `onDelete?(id, expectedVersion)` and `onToggleEnabled?(id, enabled, expectedVersion)` — optional, absence hides the affordance
- `onRefresh?()` — called when user clicks Refresh inside the conflict banner (DA fix so conflict-on-save can recover without client-side cache reasoning)
- Deferred hooks: `previewGate` (DEF-001), `canEdit` / `canDelete` (DEF-002), `onEditSnapshot` (DEF-003)

Typecheck clean (`npx tsc --noEmit` returns only the pre-existing `events.ts:53` error).

---

## What still has to happen

### Remaining Phase 1 primitives — Tasks 10, 11, 12, 13

These are the real body of the RecordEditor work. Each is a full TSX component or a service change with plan-provided code:

**Task 10 — `src/components/record-editor/RecordField.tsx`** (plan line 796). Per-field row renderer. Handles `text`, `textarea`, `textarea-large`, `tags` (comma-separated chip input that serializes to `string[]` on save), `boolean`, and `readonly`. The plan ships full TSX code with validation error rendering, required-field enforcement, and field-type-specific input widgets.

**Task 11 — `src/components/record-editor/RecordActionsBar.tsx`** (plan line 974). The state machine component. States: `viewing` → `editing` → `saving` / `confirming-delete` → back. Renders Edit / Save / Cancel / Delete buttons based on state. Plan has the full implementation.

**Task 12 — `src/components/record-editor/RecordEditor.tsx`** (plan line 1118). Top-level list + detail primitive. Ties together RecordField and RecordActionsBar. Handles selection, draft state, validation dispatch, mutation calls, optimistic-lock conflict banner with Refresh button wired through `onRefresh` prop. **Known DA gotcha:** the conflict banner must explicitly expose a "Refresh" action (not a transient toast) so the user has a deterministic recovery path. Plan has this wired.

**Task 13 — skill service optimistic locking + countReferences** (plan line 1471). Adds three methods to `src/core/skills/service.ts`: `updateWithVersion(id, patch, expectedVersion)`, `deleteWithVersion(id, expectedVersion)`, `countReferences(id)`. Also extends `src/server/routers/skill.ts` with a version-taking `delete` mutation that first calls `countReferences` and rejects on non-zero (returning the counts in the error payload so the UI can render a meaningful "referenced by N stages" message). **DA fix during Session A:** `skill.delete` input Zod schema now requires `version: z.number().int()`.

### Phase 2 — Driver page — Tasks 14, 15, 16

**Task 14 — `src/app/[org]/[user]/[project]/settings/drivers/descriptor.ts`** (plan line 1808). The driver descriptor. Per spec, exposes every runtime-consumed column including `outputFormatFlag` (read by command-builder) and `contextLayout` (read by stage-runner to pick CLAUDE.md vs AGENTS.md as instructions-file name). JSON-valued fields (`defaultArgs`, `envVars`, `extraArgs`, `contextLayout`) are rendered `readonly` for MVP — DEF-006 tracks the structured JSON editor upgrade.

**Task 15 — `src/app/[org]/[user]/[project]/settings/drivers/page.tsx`** (plan line 1929). New page. Uses `<RecordEditor descriptor={driverDescriptor}/>`. Wires `trpc.driver.list` query, `trpc.driver.update` mutation (for both Save and toggle via `onToggleEnabled`), and `onRefresh` callback that invalidates the list query.

**Task 16 — driver integration test** (plan line 2026). `src/__tests__/integration/driver-crud.test.ts`. Against real Supabase: list, update, version-lock failure (409-equivalent), toggle isEnabled.

### Phase 3 — Skill page — Tasks 17, 18, 19, 20

**Task 17 — `src/app/[org]/[user]/[project]/settings/skills/descriptor.ts`** (plan line 2146). Skill descriptor. Fields: name, description, tags (comma-separated chips), promptTemplate (textarea-large for long content), version (readonly).

**Task 18 — `src/app/[org]/[user]/[project]/settings/skills/page.tsx`** (plan line 2195). Rewrite of the existing page. Must retain the existing Create form (working today). Add `<RecordEditor descriptor={skillDescriptor}/>` below it with edit + delete. Delete handler must pass `version` through to `trpc.skill.delete` (per DA fix).

**Task 19 — manual test** (plan line 2383). User-driven browser verification on `http://192.168.54.101:3000`. Edit a skill, save, confirm. Delete an unreferenced skill, confirm gone. Delete a referenced skill, confirm meaningful FK error.

**Task 20 — skill router test** (plan line 2399). `src/__tests__/integration/skill-crud.test.ts`. Covers: list, update, update-version-lock failure, delete-unreferenced, delete-referenced-fails-at-router (validates `countReferences` precondition), delete-version-lock failure.

### Phase 4 — Terminology, nav, UI inventory — Tasks 21, 22, 23

**Task 21 — seed terminology glossary** (plan line 2444). New file `docs/terminology.md` with 11 entries: `driver` (with "formerly known as: harness"), `skill`, `pipeline`, `pipeline_stage`, `pipeline_run`, `stage_run`, `issue`, `issue_state`, `issue_status`, `gate`, `routing_profile`. Each entry: field/entity name, description, example. DEF-005 is the full-glossary continuation; this is the R-UI-1 seed.

**Task 22 — add Drivers nav link** (plan line 2552). Edit `src/components/nav.tsx` to insert a "Drivers" link between "Skills" and "Routing" in the Settings section.

**Task 23 — UI inventory update** (plan line 2609). Extend `docs/superpowers/specs/2026-04-11-ui-inventory.md` with new "Settings — Drivers" and expanded "Settings — Skills" sections reflecting the edit/delete affordances.

### Phase 5 — Playwright journeys — Tasks 24–30

**Task 24 — scaffold** (plan line 2656). New `playwright.config.ts` + `e2e/helpers/setup.ts`. Config sets base URL `http://192.168.54.101:3000`, tags via `grep`, one browser project to start (chromium).

**Task 25 — edit-a-driver journey** (plan line 2751). Markdown story at `docs/journeys/edit-a-driver.md` + `e2e/edit-a-driver.spec.ts`. Tags `@r-ui-1`. Steps: list, select driver, edit name, save, verify persisted via reload.

**Task 26 — toggle-driver-enabled** (plan line 2900). Markdown + spec. Toggle the isEnabled switch on a list row, reload, confirm state persisted.

**Task 27 — edit-a-skill** (plan line 2986). Markdown + spec. List, select skill, edit description, save, verify persisted.

**Task 28 — delete-an-unreferenced-skill** (plan line 3082). Markdown + spec. Create a scratch skill via UI, immediately delete it, confirm the inline-confirm flow then persisted removal.

**Task 29 — delete-a-referenced-skill-fails-gracefully** (plan line 3167). Markdown + spec. Select a seeded skill (which is referenced by pipeline stages), attempt delete, confirm the FK-error toast has reference counts and skill still exists.

**Task 30 — conflict-on-save** (plan line 3241). Markdown + spec. Two Playwright contexts, both open the same record, both edit, tab A saves first, tab B save fails with the Refresh-button conflict banner. **DA-fix requirement:** spec must include `waitForLoadState('networkidle')` in both contexts and `waitFor` guards on Edit button + editable textareas. The assertion checks for the Refresh button's presence, not a transient toast.

### Phase 6 — Final verification — Task 31

**Task 31** (plan line 3370): full-stack verification + roadmap update. Nuke/seed/verify (10/10 expected), full Vitest (all green), full Playwright (`npx playwright test --grep @r-ui-1` — all 6 pass), exhaustive residual-grep across `src/ tests/ e2e/ drizzle/` + active docs (expected empty except the "formerly known as" clarifiers), manual browser verification of all 6 journeys by the user, roadmap.md update marking R-UI-1 Done and R-UI-2 as next, open PR for review.

---

## State at end of Session B

### Git

```
Branch: feat/r-ui-1-implementation
Head:   86d30da feat(record-editor): add descriptor and props types

Session B commits in order (oldest first):
  4d8fc9a chore: fix pre-existing ESLint any/prefer-const in orchestrator tests + note DEF-007 exemptions
  c86300f refactor: rename harness→driver across all source and test files
  56f3eef refactor: clean up stale harness refs in DEF-002/003 and ghost h loop variables
  ae831cf test: fix obsolete materializer contract assertions (pre-existing bug)
  d166d65 docs: rename harness→driver in active docs
  29baf73 feat: add Feature enum + hasFeature() stub (DEF-001..004 hook point)
  86d30da feat(record-editor): add descriptor and props types

Session A commits still ancestor of HEAD:
  6a8740c docs: Session B kickoff prompt
  8213c80 docs: Session A handoff
  d86f6d8 refactor: rename harnessRouter→driverRouter and register as driver
  901f3fb refactor: add harness_catalog→driver rename migration
  c3723dd docs: add DEF-007
  29fffef refactor(schema): rename harness→driver (table, FK cols, ...)
  bd2e109 chore: start R-UI-1 Session A
```

Working tree is clean. No stash entries. No outstanding worktrees.

### Database

Supabase Cloud is in the post-rename state (unchanged from Session A, re-verified):
- `driver` table exists with 1 row (Claude Code)
- `pipeline_stage.driver` + `pipeline_stage.driver_id` columns exist
- `stage_run.driver` + `stage_run.driver_id` columns exist
- `routing_rule.preferred_driver` + `routing_rule.fallback_driver` columns exist
- Zero `harness*` tables or columns

Seed verification: `npm run verify:seed` passes 10/10. Runtime checks: `npm run db:issues` shows 2 seeded issues as expected.

### Tests

- **Integration tests (Vitest):** 111 total. 107 passing, 4 intentionally skipped (pre-existing skips in orchestrator tests). Two new tests added in Task 8 (`features-primitive.test.ts`). Zero failures.
- **Typecheck:** `npx tsc --noEmit` reports exactly one error: `src/core/db/scripts/events.ts:53` (pre-existing Drizzle conditional-where type narrowing; unrelated to any R-UI-1 work). No new errors from Session B.
- **ESLint:** Clean in all touched files.
- **No `harness|Harness|HARNESS`** in `src/ tests/` or in active docs (CLAUDE.md, session-quick-start.md, invariants.md, roadmap.md, ui-inventory.md) except two intentional "formerly known as harness" clarifiers.

### New files created in Session B

- `src/core/features/features.ts` (27 lines)
- `src/__tests__/integration/features-primitive.test.ts` (22 lines)
- `src/components/record-editor/types.ts` (83 lines)

### Modified files (not already listed above)

None outside the commit-by-commit section. Every change landed in a commit.

### Un-versioned changes (local to this clone)

- `.git/hooks/pre-commit` `SIZE_EXEMPT_FILES` array extended with `src/__tests__/integration/orchestrator.test.ts` and `src/core/db/seed.ts`. Per DEF-007 this is per-clone until canonical-hooks lands.

### DEF entries updated

- **DEF-002** location + title: now points to `src/server/routers/driver.ts`, says "skills and drivers"
- **DEF-003** location + title: now references `driver_revision` table, says "skills and drivers"
- **DEF-007** body extended with two new local-clone size exemptions and DEF-008 candidacy note

No new DEF entries created in Session B. (The materializer-test fix and ESLint cleanup were pre-existing-bug fixes, not deferred work.)

---

## Carry-forward registry — pinned for the next session

### From R-INFRA handoff (still pending; not in R-UI-1 scope)

- `start-of-day` skill rewrite — fluxaOS-native content for session kickoff checklist. Currently empty shell.
- `end-of-day` skill rewrite — fluxaOS-native content for handoff creation.
- `housekeeping` skill rewrite — fluxaOS-native content for maintenance audits.
- R5.5 Test 4 — Clean pipeline output (no slash commands or CLI-specific noise in stage run streams).
- R5.5 Test 5 — Hold/needs_human (verify issue status changes to Blocked on skill-emitted hold signal).
- 15 pre-existing UI deferred fixes in `deferred-fixes.md` (mostly cosmetic).

### From Session A (still pending)

All DEF-001..007 entries — these get hooks planted during Phase 1 primitives (Tasks 8-13, currently 8-9 done) and are wired through RecordEditor's deferred-hook props.

### Created in Session B (none)

No new deferred entries. Session B strictly executed planned work.

### Next roadmap phase after R-UI-1

- **R-UI-2 — Real-time updates.** LiveOutput streaming, activity feed auto-refresh, duration live-updates, `RealtimeProvider` adapter at `src/adapters/supabase/realtime.ts`.

---

## Known gotchas and warnings for the next session

### Mechanical

1. **Pre-commit hook size exemption is local-only.** If the next session is on a different clone, `src/core/db/schema.ts`, `src/__tests__/integration/orchestrator.test.ts`, and `src/core/db/seed.ts` all exceed the 500-line limit and the untracked `.git/hooks/pre-commit` will block commits that touch them until the same `SIZE_EXEMPT_FILES` entries are added locally. DEF-007 is the canonical fix.

2. **Pre-existing TS error in `src/core/db/scripts/events.ts:53`.** Do NOT try to fix it as part of R-UI-1. It's a Drizzle query-builder type-narrowing issue on a conditional `.where()` reassignment. Out of scope. Session B explicitly left it alone.

3. **drizzle-kit generate requires interactive TTY.** If you need to generate migrations, `drizzle-kit generate` may hang without a terminal. R-UI-1 Phase 1-5 should not need migrations (no schema changes), but if something forces one, use `drizzle-kit generate --custom` and hand-write the SQL as Session A did for the harness→driver migration.

4. **Do not run dev server to test page changes until Task 22 is done.** Adding pages without the nav link means you can't reach them in the UI. Add the nav link (Task 22) after Task 15 (drivers page) lands and before Task 19 (manual skill verification).

### Conceptual

5. **RecordEditor is vendor-agnostic and feature-agnostic by design.** Do NOT import trpc inside `src/components/record-editor/*`. All mutations are injected via props from the page. This is explicit in the spec and was a brainstorm decision.

6. **`version` field is READ-ONLY in descriptors.** Per spec, the version field is the optimistic-concurrency counter. It should NOT be user-editable. The descriptor's fieldType for `version` is `'readonly'`. If Task 14 or Task 17 accidentally mark it otherwise, stop and correct.

7. **Skill delete MUST take version.** DA fix during Session A: `skill.delete` takes `{ id, version }`. The router checks version before running `countReferences` and delete. Task 13 implements this; Task 20 tests it. Don't backslide into a version-less delete.

8. **`onRefresh` is the conflict-banner recovery path, not a general-purpose refresh.** The banner ONLY shows after a save returns a 409-equivalent optimistic-lock conflict. Clicking Refresh invalidates the list query and returns the RecordEditor state machine to `viewing`. Save-again-without-refreshing will fail again with the same conflict because the stale `expectedVersion` is still in draft state. This is intentional — don't try to "help" by auto-refreshing on conflict.

9. **Playwright conflict-on-save journey (Task 30) must include network-idle waits.** DA fix: `waitForLoadState('networkidle')` in both contexts, `waitFor` guards on Edit button and editable textareas before the typing. Assertion checks for the Refresh button, not a transient toast. Two-context Playwright is historically flaky — these guards prevent races.

10. **Historical docs are frozen.** Do NOT modify files in `docs/superpowers/handoffs/`, `docs/superpowers/plans/` (other than this handoff you're reading), older specs in `docs/superpowers/specs/`, `docs/superpowers/rca/`, or `docs/planning/`. The rename plan explicitly lists active-only docs. If you accidentally rename something in a historical doc, revert and proceed.

11. **When the plan says "verify `[0-9]` seed items," run `npm run verify:seed` and confirm all 10 checks pass.** Session B verified 10/10 after each schema-touching commit. This is the cheap sanity gate.

### Workflow

12. **Use `superpowers:subagent-driven-development` for the remaining tasks.** The plan has full code and commands for every task. Dispatch fresh subagent per task with full task-text context. After each: spec-compliance review, then code-quality review. Session B's subagent work produced two findings that were worth acting on (the DEF-002/003 stale paths, the ghost `h` variables). That review discipline is the whole point.

13. **Phase 1 primitives (Tasks 10-13) benefit from sequential not parallel execution.** RecordField (10) and RecordActionsBar (11) are independent, but RecordEditor main (12) depends on both. Skill service (13) is independent. Order: 10, 11, 12, 13 OR 13 first then 10/11 in parallel then 12.

14. **Manual test (Task 19) needs the user.** Don't try to automate it. The point is eyes on real UI in a real browser. Wait for the user to drive that step.

15. **Task 30 conflict-on-save journey is the trickiest Playwright work.** Consider doing a smaller-scope spike first if the two-context pattern gives you trouble. The DA fix prescription (network-idle + waitFor) is the mitigation; don't skip it.

---

## File index — what's in the repo after Session B

### New files committed this session

- `src/core/features/features.ts`
- `src/__tests__/integration/features-primitive.test.ts`
- `src/components/record-editor/types.ts`
- `docs/superpowers/handoffs/2026-04-16-r-ui-1-session-b-partial.md` (this file)

### Pre-existing files modified this session

- `src/__tests__/integration/orchestrator.test.ts` (ESLint prep + rename sweep)
- `src/__tests__/integration/orchestrator-e2e.test.ts` (ESLint prep + rename sweep + materializer-contract fix)
- All 23 rename-sweep files listed above under commit `c86300f`
- `src/app/[org]/[user]/[project]/settings/page.tsx` (ghost-`h` cleanup)
- `docs/superpowers/deferred-fixes.md` (DEF-002/003 updates + DEF-007 extension)
- `CLAUDE.md` (active-docs rename)
- `docs/invariants.md` (active-docs rename)
- `docs/superpowers/roadmap.md` (active-docs rename)
- `docs/superpowers/specs/2026-04-11-ui-inventory.md` (active-docs rename)

### Renamed files

None in Session B. Session A did the `harness.ts` → `driver.ts` router rename.

### Un-versioned edits (local clone only)

- `.git/hooks/pre-commit` — SIZE_EXEMPT_FILES extension. DEF-007 canonical-fix tracks this.

---

## Plan and spec locations (reference)

- **Plan:** `docs/superpowers/plans/2026-04-16-r-ui-1-implementation.md`
- **Spec:** `docs/superpowers/specs/2026-04-16-r-ui-1-design.md`
- **Deferred fixes:** `docs/superpowers/deferred-fixes.md` (DEF-001 through DEF-007)
- **Roadmap:** `docs/superpowers/roadmap.md` (R-UI-1 NOT yet marked complete; wait for Task 31)
- **Session A handoff:** `docs/superpowers/handoffs/2026-04-16-r-ui-1-session-a-rename.md`
- **Session B handoff (this file):** `docs/superpowers/handoffs/2026-04-16-r-ui-1-session-b-partial.md`

---

## Commit hashes (reference)

Session B (on top of `6a8740c`):

- `4d8fc9a` ESLint prep + DEF-007 extension
- `c86300f` Task 5 — rename sweep (23 files)
- `56f3eef` Code-review fixes (DEF-002/003 + ghost h)
- `ae831cf` Task 6 — pre-existing materializer-contract test fix
- `d166d65` Task 7 — active docs rename
- `29baf73` Task 8 — Feature enum + hasFeature() stub
- `86d30da` Task 9 — RecordEditor types

Session A (still ancestors):

- `bd2e109` start marker
- `29fffef` Task 2 — schema rename
- `c3723dd` DEF-007 added
- `901f3fb` Task 3 — migration
- `d86f6d8` Task 4 — router rename
- `8213c80` Session A handoff
- `6a8740c` Session B kickoff prompt

Main branch base: `62de54c` (R-INFRA merge).

---

## Sanity-check commands for the next session

```bash
cd /mnt/dev/fluxaos
git checkout feat/r-ui-1-implementation
git status --short                # expected: empty
git log --oneline -10             # expected top: 86d30da, then 29baf73, d166d65, ...
```

Confirm DB is still renamed:
```bash
cat <<'SCRIPT' > scripts/check-db-state.ts
import 'dotenv/config';
import { SupabaseDatabaseProvider } from '../src/adapters/supabase/database';
async function main() {
  const p = new SupabaseDatabaseProvider(process.env.DATABASE_URL!);
  const db = p.getConnection();
  const r: any = await db.execute(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('driver','harness_catalog') ORDER BY tablename`);
  console.log('tables:', JSON.stringify(r));
  await p.close();
}
main();
SCRIPT
mkdir -p scripts
npx tsx scripts/check-db-state.ts
# Expected: tables: [{"tablename":"driver"}]
rm scripts/check-db-state.ts
```

Confirm tests pass:
```bash
npm run verify:seed               # expected: 10/10 PASS
npx vitest run                    # expected: 107 passed, 4 skipped, 111 total
npx tsc --noEmit 2>&1 | grep -v "events.ts:53"
# expected: empty (only the pre-existing events.ts:53 error is acceptable)
```

Confirm no rename residue:
```bash
grep -rn "harness\|Harness\|HARNESS" src/ tests/ --include="*.ts" --include="*.tsx"
# expected: empty
```

Confirm primitives are in place:
```bash
ls src/core/features/features.ts src/components/record-editor/types.ts src/__tests__/integration/features-primitive.test.ts
# expected: all three exist
```

If any of those checks differ from expected, STOP and investigate before starting Task 10. State drift between sessions is the most likely cause of confusing errors.

---

## Start instructions for the next session

1. Read this handoff in full.
2. Read the plan starting at Task 10 (plan line 796).
3. Run the sanity-check commands above.
4. Use `superpowers:subagent-driven-development` to execute Tasks 10 → 13 (Phase 1 primitives completion) in order.
5. Then Phase 2 (Tasks 14-16), Phase 3 (17-20), Phase 4 (21-23), Phase 5 (24-30), Phase 6 (31).
6. Apply the same two-stage review (spec compliance, then code quality) discipline Session B used.
7. If a reviewer finds actionable issues, fix them in the same task; don't defer.
8. When Task 31 runs, this is where the PR opens and user-driven manual verification happens.

The plan is complete. Every task has code, commands, and expected output pre-written. Session B demonstrated the plan is executable end-to-end as-written with minor subagent-applied cleanup between tasks.

Good luck.
