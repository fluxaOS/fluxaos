# R-POLISH-CORE — Implementation plan

**Date:** 2026-04-25
**Spec:** [`../specs/2026-04-25-r-polish-core-design.md`](../specs/2026-04-25-r-polish-core-design.md)

---

## Plan-phase reconciliation

1. **Seed deploy stage at `seed.ts:163`.** ✅ Confirmed.
2. **Seed deploy skill at `seed.ts:271`.** ✅ Confirmed (`name: 'deploy', description: 'Deploy — merge approved PRs'`).
3. **`verify:seed` assertions at `tests/verify/seed-check.ts:70` (4 stages) and `:74` (5 skills).** ✅ Both will need decrement to 3 + 4.
4. **R-SMOKE in-test mutations at `e2e/r-smoke.spec.ts`.** Already inspected — flips review gate AND deletes deploy stage. Both lines removable post-R1+R2.
5. **Drizzle meta drift.** `_journal.json` has 8 entries; `meta/` has only `0000_snapshot.json` + `0003_snapshot.json`. Significant gap (5 missing). Rebaseline candidate but high-risk if `drizzle-kit generate` misreads the live schema.

**Plan-phase decisions on open questions (defaulted per AGENT_BEHAVIOR.md):**

- **R4 (drizzle rebaseline) is its own wave** because it's the riskiest item. If it produces unexpected SQL diffs, defer to a follow-up phase rather than block R-POLISH-CORE.
- **Seed deletion approach:** drop the deploy stage entry from `stagesDef` and the deploy skill from `skillsDef`. No defensive "delete if exists" — the seed is the source of truth, fresh `nuke + seed` produces the new shape.
- **Existing operator DBs:** documented in commit message but not auto-migrated. fluxaOS is single-operator alpha; the operator runs nuke+seed when ready.

---

## Task breakdown

### Wave 1 — Seed config fix

**T1.** Edit `src/scripts/db/seed.ts`:
- Remove the `{ name: 'deploy', sortOrder: 4, gateMode: 'hold', gateRules: {} }` entry from `stagesDef` (line 163).
- Remove the `{ name: 'deploy', description: 'Deploy — merge approved PRs' }` entry from `skillsDef` (line 271).
- Change `review` stage entry from `gateMode: 'hold'` to `gateMode: 'auto'` (line 162).

**T2.** Edit `tests/verify/seed-check.ts`:
- Stage count assertion: 4 → 3.
- Skill count assertion: 5 → 4.

**T3.** Verify locally:
- `npx tsc --noEmit` clean.
- `tsx src/scripts/db/nuke.ts && npm run db:seed && npm run verify:seed` → 10/10 PASS.
- `npx vitest run` 249/249.

**Commit:** `R-POLISH-CORE W1: drop deploy pipeline_stage + skill; flip review gate to auto`.

### Wave 2 — Update R-SMOKE journey

**T4.** Edit `e2e/r-smoke.spec.ts`:
- Remove the `UPDATE "pipeline_stage" SET "gate_mode" = 'auto' WHERE "name" = 'review'` SQL line.
- Remove the `DELETE FROM "pipeline_stage" WHERE "name" = 'deploy'` SQL line.
- Remove the explanatory comment block above them; replace with a one-liner pointing at the now-correct seed.
- The journey now runs against the unmodified seed.

**T5.** Verify R-SMOKE journey live (cred-gated; assumes `.env.local` + sandbox repo):
- `cd /mnt/dev/fluxaos && set -a; source .env; source .env.local; set +a`
- `cd /mnt/dev/fluxaos/.worktrees/r-polish-core`
- `PLAYWRIGHT_BASE_URL=http://192.168.54.101:3013 npx playwright test e2e/r-smoke.spec.ts --reporter=line`
- Expected: green in ≤2 min.

**Commit:** `R-POLISH-CORE W2: drop seed mutations from R-SMOKE journey`.

### Wave 3 — Drizzle meta rebaseline (optional, bail-out allowed)

**T6.** Inspect drift:
- `npx drizzle-kit generate --name probe-snapshot-drift` (NEW migration; capture diff).
- If the diff is empty (no SQL): drizzle is happy, and we have a fresh snapshot. Delete the empty SQL file; keep the snapshot.
- If the diff is non-empty: real schema/migration drift exists. Surface in a separate DEF entry and BAIL on this wave; mark T7 + T8 as deferred.

**T7.** If T6 confirmed clean:
- Verify all `meta/<idx>_snapshot.json` files now align with `_journal.json` entries.
- Run `npx drizzle-kit generate` again; assert no new diff is produced.

**T8.** Commit if successful: `R-POLISH-CORE W3: rebaseline drizzle meta snapshots`.

If bailed: file `DEF-022 (drizzle schema drift)` in `docs/superpowers/deferred-fixes.md`. Roadmap stays.

### Wave 4 — Roadmap

**T9.** Update `docs/superpowers/roadmap.md`:
- Add R-POLISH-CORE row to Done table with spec + plan links.
- Update Alpha "Next" to R-POLISH-DOCS.
- Append one sentence to current-engine-state paragraph: "Production seed produces a 3-stage autonomous-friendly pipeline (research auto → implement rules → review auto) so R-SMOKE runs against the unmodified seed."

**Commit:** `R-POLISH-CORE W4: roadmap`.

---

## Verification matrix per wave

| Gate | W1 | W2 | W3 | W4 |
|---|---|---|---|---|
| `tsc --noEmit` | required | required | required | required |
| `vitest run` | required | required | required | required |
| `verify:seed` 10/10 | required | required | required | required |
| `playwright test e2e/r-smoke.spec.ts` (live) | n/a | required | required | required |
| `drizzle-kit generate` clean | n/a | n/a | required | n/a |
| Pre-commit lint + 500-line cap | required | required | required | required |

---

## Rollback strategy

Each wave is one atomic commit. Pure data + spec mutation; no runtime code change. Revert is `git revert <sha>` per wave.

---

## Goal-backward verification

**Phase goal:** Production seed produces an engine-correct config that R-SMOKE runs against without mutation, plus drizzle meta is rebaselined.

| Goal element | Delivered by |
|---|---|
| Drop broken deploy stage | W1 |
| Switch review to auto | W1 |
| Update verify:seed assertions | W1 |
| Drop in-test seed mutations | W2 |
| Live R-SMOKE green without mutations | W2 verification |
| Drizzle meta rebaselined | W3 (or bailed → DEF) |
| Roadmap reflects done | W4 |
