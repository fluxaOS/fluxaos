# Session Handoff — Agnostic-Core Allowlist Retirement (FLX-78, FLX-79, FLX-68)

**Date:** 2026-04-27 16:30 PDT → 2026-04-27 ~17:00 PDT (~30 min — supplemental tail of the FLX-69 alpha-bar session)
**Branch at start:** `main` at `ad74ba0`
**Branch at end:** `main` at `da2809d`
**Model:** Claude Opus 4.7 (1M context)
**PRs merged:** #129
**Caveman mode:** active (full)
**Mode:** autonomous execution

---

## Session Scope

Direct continuation of the FLX-69 alpha-bar session (handoff `2026-04-27-flx-69-alpha-bar-verified-session-handoff.md` shipped via PR #128). User asked for the next pickup recommendation among open alpha tickets with specs/plans. Picked the FLX-78 + FLX-79 pair to fully retire the vendor-agnostic-core allowlist that FLX-73 had documented.

Side discovery: FLX-68 was already complete at the service + tRPC layer (FLX-77 had bundled the work). Closed without code change.

---

## What Shipped

### PR #129 — `fix(core): retire agnostic-core allowlist (FLX-78, FLX-79)`

Squash-merged as `da2809d`.

#### FLX-78 — driver.contextLayout from DB only

- `src/core/orchestrator/stage-runner.ts`: dropped the `'CLAUDE.md' / 'context.md'` fallback. Throws now if `driverRow.contextLayout` is null with a message pointing at `seed.ts`.
- `src/core/db/schema.ts`: dropped the JSON-literal column default. Concrete value lives in seed and migrations only.
- `drizzle/0010_flx_78_drop_driver_context_layout_default.sql`: hand-written migration (drizzle-kit generate is unusable in autonomous sessions per DEF-019). `ALTER TABLE driver ALTER COLUMN context_layout DROP DEFAULT`.
- `src/core/skills/materializer.ts`: comment reworded to drop the literal references.
- `src/__tests__/integration/crud-factory.test.ts` + `driver-crud.test.ts`: bulk-edited to pass `contextLayout` explicitly when inserting test driver rows (sed replace; biome reformat).

#### FLX-79 — post-deploy state from `config_entry`

- `src/core/services/issue.ts`: new `resolveStateByConfigKey` private + `getStateByConfigKey` public method. Mirrors `resolveStatusByConfigKey` / `getStatusIdByConfigKey`.
- `src/core/deploy/deploy-bridge.ts`: lookup via `getStateByConfigKey('issues.state.on_deploy_complete_key')` instead of literal `'review'`.
- `src/scripts/db/seed.ts`: new config_entry row keyed `issues.state.on_deploy_complete_key` with seed value `"review"`. Seed now writes 6 config entries (was 5).
- `src/__tests__/integration/deploy-bridge.test.ts`: fixture seeds the config_entry alongside the project + state rows (added to `cleanup` array for teardown).

#### Verifier

- `src/scripts/verify-agnostic-core.ts`: ALLOWLIST drained to `[]`. Future vendor-name or stage/state literals in `src/core/` fail the build with no exemption.

### Linear closures

- **FLX-68 → Done** (no code, already shipped at the service + tRPC layer via FLX-77 in PR #117). Posted closure comment with file/line evidence.
- **FLX-78 → Done** (PR #129).
- **FLX-79 → Done** (PR #129).

---

## Verification Matrix

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ green |
| `npx biome check` (post-autofix) | ✅ green |
| `npm run verify:agnostic-core` | ✅ 0 hits, 0 unallowed |
| `npm run db:migrate` | ✅ 0010 applied |
| `npm run db:seed` | ✅ 6 config entries (was 5) |
| `npm run verify` | ✅ 2/2 PASS |
| `npx vitest run` | ✅ 246 pass + 1 skip + 1 pre-existing flake (`cleanup-triggers`, passes in isolation; unrelated to session) |
| Pre-push gates | ✅ pass |
| CI `check` | ✅ pass on PR #129 |

---

## Linear State Changes

| Ticket | Pre | Post |
|---|---|---|
| FLX-68 | Backlog (High, Bug) | Done |
| FLX-78 | Backlog (Medium) | Done |
| FLX-79 | Backlog (Medium) | Done |

Allowlist is now empty in `verify-agnostic-core.ts`. Cumulative session-pair tally: 4 alpha tickets closed (FLX-69, FLX-81, FLX-78, FLX-79) + FLX-68 administrative closure + FLX-80 cancelled + FLX-82 filed for the self-target collision (Medium, Bug Backlog).

---

## Current State

- HEAD: `da2809d` on `main`
- Branches: `* main` only
- Working tree: clean
- Stashes: none
- Worktrees: 1 (`/mnt/dev/fluxaos` on `main`)
- Dev server: still running on port 3003 (long-lived)
- `.env.local`: sandbox values restored after the self-target experiment was reverted earlier in the parent session

---

## Files Touched (This Sub-Session)

| File | PR | Change |
|---|---|---|
| `src/core/orchestrator/stage-runner.ts` | #129 | drop CLAUDE.md fallback, comment reword |
| `src/core/db/schema.ts` | #129 | drop column default |
| `drizzle/0010_flx_78_drop_driver_context_layout_default.sql` | #129 | new migration |
| `drizzle/meta/_journal.json` | #129 | journal entry for 0010 |
| `src/core/skills/materializer.ts` | #129 | comment reword |
| `src/__tests__/integration/crud-factory.test.ts` | #129 | pass contextLayout explicitly |
| `src/__tests__/integration/driver-crud.test.ts` | #129 | pass contextLayout explicitly |
| `src/core/deploy/deploy-bridge.ts` | #129 | config_entry lookup |
| `src/core/services/issue.ts` | #129 | new resolveStateByConfigKey + getStateByConfigKey |
| `src/scripts/db/seed.ts` | #129 | new config_entry row |
| `src/__tests__/integration/deploy-bridge.test.ts` | #129 | fixture seeds new config_entry |
| `src/scripts/verify-agnostic-core.ts` | #129 | drain ALLOWLIST |

---

## Memories Saved

None added to `auto memory`. Existing memory index already covers behavioral rules in play.

---

## Suggested Next-Session Prompt

```
fluxaOS post-alpha continuation session.

Context: main at da2809d. THE ALPHA BAR is verified (FLX-69 shipped
prior session) AND the agnostic-core allowlist is now empty (FLX-78,
FLX-79 shipped this session). Cumulative alpha tally for the day:
6 tickets closed (FLX-69, FLX-81, FLX-78, FLX-79, FLX-68, FLX-80)
+ FLX-82 filed for the self-target/CLAUDE.md materializer collision.

13 alpha tickets remain in fluxaOS Alpha project — mostly CRUD specs
(persona / provider / routing / driver-create / project) and edge-case
specs (FLX-70 mid-run override, FLX-71 manual-without-daemon — note
this one needs rescoping per FLX-80 architecture decision, FLX-72
crash recovery, FLX-75 strengthen real-anthropic spec, FLX-76 r-smoke
edge cases).

Next pickup recommendation: FLX-71 needs triage first — its premise
("manual path independent of daemon") was invalidated by the FLX-80
decision (engine has no path independent of daemon). Likely close
or rewrite. After that, the CRUD specs (FLX-60, 64, 65, 66) are
mechanical and high-yield for the matrix.

Read: docs/superpowers/handoffs/2026-04-27-allowlist-retirement-session-handoff.md
+ docs/superpowers/specs/2026-04-27-alpha-verification-matrix.md.
```
