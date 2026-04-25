# R-POLISH-CORE — Engine-correctness polish

**Phase:** R-POLISH-CORE (subset of R-POLISH)
**Status:** SPEC
**Created:** 2026-04-25
**Author:** Claude Opus 4.7 (1M)
**Depends on:** R-SMOKE (Done) — surfaced the seed-config issues this phase fixes.

---

## 1. Problem

R-SMOKE shipped green by mutating the seed at journey start: it flipped `review` gate-mode to `auto` and dropped the `deploy` pipeline_stage entirely. Both mutations exist because the production seed config breaks the autonomous alpha workflow:

1. **`deploy` pipeline_stage skill prompt** assumes the PR already exists and emits `hold/already_complete` on every alpha run, which short-circuits `completePipelineRun` so the deploy bridge never fires. The seed ships a stage that breaks the engine.
2. **`review` and `deploy` gate modes are `hold`.** Halts pipeline at `running` indefinitely. Fine for human-in-the-loop, broken for autonomous alpha.
3. **Drizzle `meta/` snapshots have drifted.** Journal lists 8 migration entries, `meta/` only has 2 snapshots (0000, 0003). 0006 was hand-introduced. R-RUNTIME's 0007 was hand-written for the same reason. `drizzle-kit generate` cannot produce correct diffs against the live schema.

R-POLISH-CORE fixes all three so a fresh `npm run db:seed` produces an engine-correct config that R-SMOKE runs against without mutation.

## 2. Goals

- Production seed produces a pipeline that runs end-to-end without `hold` gates blocking autonomous flow.
- The `deploy` stage is either fixed or removed — no broken stages in the seed.
- R-SMOKE journey passes WITHOUT the in-test `UPDATE pipeline_stage SET gate_mode='auto'` and `DELETE pipeline_stage WHERE name='deploy'` mutations.
- Drizzle meta snapshots rebaselined so future schema changes can use `drizzle-kit generate` cleanly.

## 3. Non-goals

- **README + terminology + Archon attribution** — separate R-POLISH-DOCS phase. Out of scope here.
- **Alpha shipping criteria.** Engine-correctness is the gate; doc polish follows.
- **Multi-stage gate redesign.** The alpha pipeline is intentionally simple: research → implement → review. Adding stages or rules is post-alpha.
- **Webhook integration for `onPrClosed`.** Per R-SMOKE spec §9.

## 4. Requirements

### R-POLISH-CORE.R1 — Drop the `deploy` stage from production seed

- The `deploy` skill is a placeholder ("merge approved PRs") that pre-supposes a PR exists at stage time. The actual deploy work happens in `terminalHook → deployBridge.deploy()` after the LAST stage proceeds. There is no need for a separate `deploy` pipeline_stage in alpha.
- Remove the `{ name: 'deploy', sortOrder: 4, gateMode: 'hold', gateRules: {} }` entry from `stagesDef` in `src/scripts/db/seed.ts`.
- Remove the `{ name: 'deploy', description: 'Deploy — merge approved PRs' }` entry from `skillsDef` in the same file.
- Drop any wiring that connects the deploy skill to the deploy stage (verify nothing references it post-deletion).
- Issue-state catalog (`deploy` state) STAYS — it's part of the human-driven issue lifecycle (review → deploy → complete by an operator). Different concern from the pipeline_stage.

### R-POLISH-CORE.R2 — Switch `review` gate mode to `auto`

- The current `review` stage uses `gateMode: 'hold'`, which halts a pipeline_run at `running` for human sign-off before the deploy bridge fires. For autonomous alpha, `auto` is correct: review skill emits `proceed` (Claude declares the change reviewable) → next stage (now removed per R1, so this IS the last stage) → `completePipelineRun` → deploy bridge → PR opens.
- Update `stagesDef` line 162 in `src/scripts/db/seed.ts`: `gateMode: 'hold'` → `gateMode: 'auto'`.
- Skill prompt unchanged — review skill already emits proceed/rework verdicts based on gate evaluation.

### R-POLISH-CORE.R3 — Update R-SMOKE to drop the in-test seed mutations

- R-SMOKE no longer needs the `UPDATE pipeline_stage SET gate_mode='auto' WHERE name='review'` line.
- R-SMOKE no longer needs the `DELETE FROM pipeline_stage WHERE name='deploy'` line.
- Remove both. Re-run live to confirm the journey is still green.

### R-POLISH-CORE.R4 — Rebaseline drizzle meta snapshots

- Run `npx drizzle-kit generate` with `dropTablesFilter` set such that no new SQL files are produced (we only want fresh snapshots that match the live schema). If drizzle-kit doesn't cleanly produce only-snapshots without an SQL diff, the alternative is to delete `drizzle/meta/` entirely and run `drizzle-kit generate --custom` against the current schema, then verify the journal matches the existing migration files.
- After rebaseline, `drizzle/meta/_journal.json` should have one entry per migration in `drizzle/*.sql`, and `drizzle/meta/<idx>_snapshot.json` should exist for each.
- Verification: a no-op edit to schema followed by `drizzle-kit generate` should produce an empty migration (no SQL diff) and a new snapshot. Revert the no-op.

### R-POLISH-CORE.R5 — Verification

- `npx tsc --noEmit` clean.
- `npx vitest run` 249/249 (no integration tests changed by this phase except seed coverage).
- `npm run verify:seed` 10/10 PASS (seed assertions test issues + stage count; will need a count update if seed test asserts 4 stages).
- `npx playwright test e2e/r-smoke.spec.ts` green against live creds, WITHOUT the W2 in-test seed mutations.
- `npm run build` clean.

## 5. Risk and edge cases

- **R-SMOKE stages count assertion.** If `verify:seed` asserts "4 pipeline stages", reducing to 3 will fail it; update the assertion.
- **`gate-engine` rules tests.** The review stage's gate rules are `{}` today; flipping to `auto` doesn't change rule evaluation. Existing tests should pass unchanged.
- **Drizzle rebaseline can produce noise.** If `drizzle-kit generate` after a rebaseline emits an unexpected SQL diff, that's a real schema/migration mismatch — investigate before committing. Most likely: `drop_dead_tables` left some columns the snapshot lost track of.
- **Migration ordering.** Existing 0001 → 0009 stay untouched. Only `meta/_journal.json` and `meta/<idx>_snapshot.json` files change.
- **Existing operator databases.** Anyone with an already-seeded DB has a `deploy` stage row. Removing it from the seed doesn't auto-delete from existing DBs. Operators who care can run `nuke + seed` to refresh. Document in commit message.

## 6. Schema verification

| Column | Table | Verified? |
|---|---|---|
| `pipeline_stage.name` | pipeline_stage | yes |
| `pipeline_stage.gate_mode` | pipeline_stage | yes |
| `skill.name` | skill | yes |

No schema migration. Seed-data only.

## 7. What "Done" looks like

- Fresh `npm run db:seed` produces a 3-stage pipeline (research → implement → review) with all auto/rules gates.
- R-SMOKE journey is green without any in-test seed mutations.
- `drizzle/meta/` has snapshots for every entry in `_journal.json`.
- Roadmap moves R-POLISH-CORE to Done; R-POLISH-DOCS becomes Next.
