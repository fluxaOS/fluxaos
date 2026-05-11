# fluxaOS — Session Handoff
**Date:** 2026-05-11 | **Model:** claude-opus-4-7 | **Branch:** main | **SHA:** 449af18

---

## What Was Accomplished

### The origin: a settings form audit → systemic findings

Session began with a simple question about the Projects settings page — why is "Default pipeline" read-only? That triggered a full codebase/docs/memory/Linear audit using three parallel agents. The audit uncovered three load-bearing problems that had been compounding:

1. **Dev/UAT shared the wrong Supabase database.** Two prior sessions (2026-05-05, 2026-05-07) had silently rewritten `.env` files with UAT credentials. Every `flux server dev reset` since had been nuking UAT data. The isolation established on 2026-05-01 had been fully reversed.

2. **The "no fallbacks ever" rule was only in per-user auto-memory** — not in any repo-tracked file. Agents writing new code couldn't find it and kept introducing `?? 'default'` violations.

3. **~25 active fallback patterns in `src/`** plus four hard-coded `'fluxaos'` slug literals, a 3-link routing-resolver chain, and operational config (target repo path, workspace root, cleanup retention) in env files rather than the DB.

### Epic FLX-209 — Settings & config integrity (make UAT prod-shaped)

Filed as 1 epic + 22 child issues. 14 shipped this session (13 PRs merged to main):

**Foundation (Wave 0):**
- **FLX-123** (PR #331) — Restored dev→`dpdjlnpvxkepkwzwuvim` / UAT→`zesinfsluyxiwzldeffa` isolation. Added `nuke.ts` guard that refuses to run against UAT project ref. Dev and UAT now have independent DBs again.

**No-fallbacks rule codification (Wave 1, docs):**
- **FLX-210** (PR #336) — Added explicit "No fallbacks ever" rule to `CLAUDE.md`, `.claude/AGENT_BEHAVIOR.md`, `docs/invariants.md` (Invariant 9 rewritten), `docs/session-quick-start.md`. Score 94/100 on CLAUDE.md gate.
- **FLX-220** (PR #334) — Config classification spec: every `FLUXAOS_*` env var classified as bootstrap secret / operational config / per-project. Migration order defined. Gates FLX-221..224.

**Fallback removal (Wave 1, code):**
- **FLX-211** (PR #333) — `src/lib/trpc/provider.tsx:11` `localhost:3003` SSR fallback removed; `NEXT_PUBLIC_APP_URL` now required.
- **FLX-212** (PR #335) — `src/config/env.ts:70-75` init/ingest script defaults removed; both vars now required.
- **FLX-214** (PR #332) — `cleanup-service.ts:172` `defaultBranch ?? 'main'` replaced with invariant-violation throw.
- **FLX-225** (PR #337) — RecordEditor: readonly fields now stripped from patch at save layer (not just CSS). New Playwright spec.

**Fallback removal (Wave 2, code):**
- **FLX-213** (PR #344) — Four hard-coded `'fluxaos'` slug literals in settings pages + CLI removed. Invalid slug → `notFound()`. New Playwright test.
- **FLX-215** (PR #338) — Routing-resolver `fallbackDriver` column decided as banned silent default (dead code: no UI, no seed, no tests). Column dropped via migration.
- **FLX-216** (PR #343) — Stage-runner DB-or-default patterns fixed: `timeoutSec`, `gateMode` flipped to NOT NULL in schema; `promptTransport`, `issueRow?.title`, `projectRow?.name` all fail-fast. Migration `0025_flx_216_pipeline_stage_notnull.sql` applied.
- **FLX-217** (PR #341) — Legacy `'git'` adapter registration deleted. `resolveGitProviderForProject` is now a single-path function.
- **FLX-218** (PR #340) — git-router factory now throws `UnsupportedGitHostError` on unknown host instead of silently routing via GitHub. 25/25 tests passing.
- **FLX-219** (PR #339) — Each of the 6 DB scripts now requires its specific URL (`DIRECT_URL` for DDL, `DATABASE_URL` for DML); no `??` chain.
- **FLX-230** (PR #342) — `flux env audit` command added; runs at SessionStart via `session-audit.sh report`. Project refs documented in `docs/session-quick-start.md`.

### Infrastructure
- **1Password CLI** (`op`) installed, service account token wired into `~/.zshenv` (chmod 600). Vault: `Agents`, item: `Supabase` — dev and UAT credentials both verified.
- **UAT rebuilt** (`./flux server uat build`) after password rotation; running on `uat-flux.jdp21.com:3003`, healthy.
- **Drizzle migration sequence** — two agents both wrote `0024_*` migrations. Resolution: FLX-215 keeps 0024, FLX-216 renumbered to 0025. Both applied to dev DB; UAT will apply on next `db:migrate`.

### Sibling issues filed this session
- **FLX-231** — `deploy-bridge.test.ts` fixture missing `author` column (pre-existing; surfaced during FLX-217/218 verification).
- **FLX-232** — closed as duplicate of FLX-231 (filed independently by FLX-218 agent).
- **FLX-233** — Parallel worktrees share `git stash` namespace; 3 of 7 Wave 2 agents had stash collisions. Needs protocol fix.

---

## Session Boundary

Using session start ~2026-05-10T22:00 PDT (start of session, no `/session-start` marker found).

---

## Issues Done This Session

FLX-123, FLX-210, FLX-211, FLX-212, FLX-213, FLX-214, FLX-215, FLX-216, FLX-217, FLX-218, FLX-219, FLX-220, FLX-225, FLX-230 — **14 issues Done**, 13 PRs merged.

---

## Issues Still Open (FLX-209 epic)

| Issue | Title | Blocked by |
|-------|-------|-----------|
| FLX-207 | Projects form: every visible field editable; readonly fields look readonly | FLX-221 (needs targetRepoPath DB column) |
| FLX-221 | Migrate FLUXAOS_TARGET_REPO_PATH to project.targetRepoPath | FLX-220 (spec done ✓) |
| FLX-222 | Migrate FLUXAOS_WORKSPACE_ROOT to DB | FLX-220 (spec done ✓) |
| FLX-223 | Migrate FLUXAOS_ARTIFACTS_ROOT to DB | FLX-220 (spec done ✓) |
| FLX-224 | Migrate FLUXAOS_CLEANUP_* (4 vars) to DB | FLX-220 (spec done ✓) |
| FLX-226 | Projects form: slug rename safety | FLX-207 |
| FLX-227 | Projects form: validate repoUrl at save time | FLX-218 (done ✓) |
| FLX-228 | Projects form: pipeline dropdown via setDefaultPipeline | FLX-207 |
| FLX-229 | Projects form: kill brandId side-channel | FLX-207 |
| FLX-231 | deploy-bridge.test.ts missing author column | unblocked |
| FLX-233 | Cross-worktree stash namespace collision | unblocked |

---

## Open PRs

None. All PRs merged and branches deleted.

---

## UI / Integration Test Results

- `e2e/r-settings-alpha.spec.ts` — new test passes (FLX-213: valid slug renders, invalid slug 404s).
- `e2e/record-editor-readonly-save.spec.ts` — new test passes (FLX-225: readonly fields not in save patch).
- Dev server health: `database: healthy, auth: healthy, queue: healthy` against dev DB `dpdjlnpvxkepkwzwuvim`.
- UAT health: all three adapters healthy after rebuild.

---

## Known Blockers / Issues

- **FLX-231** (Medium) — `deploy-bridge.test.ts` fixture inserts `issue` without required `author` column. Pre-existing on main before this session. Fix: add `author: SYSTEM_ACTOR` to fixture.
- **FLX-233** (Medium) — Parallel worktree agents share `git stash` namespace. Three agents had collisions; all recovered but manually. Fix options documented in FLX-233.
- **Slug is currently `fluxaos2`** on UAT (you renamed it from `fluxaos` during this session). Dev DB still has `fluxaos`. If you want parity, reset UAT slug or do `flux server uat reset`. Not blocking.

---

## Context Decisions Made This Session

1. **UAT = prod-shaped.** UAT is the authoritative test environment. Dev nukes must never touch it.
2. **DB-driven config for GTM.** Operational config (target repo path, workspace roots, cleanup thresholds) moves to DB. Bootstrap secrets (DB credentials, API keys) stay in env.
3. **`fallbackDriver` routing column = dead code.** Evidence: no UI, no seed, no tests. Dropped rather than renamed.
4. **1Password service token in `~/.zshenv`** — env var `OP_SERVICE_ACCOUNT_TOKEN`, chmod 600 files, Agents vault.
5. **Drizzle migration collision protocol** — whichever PR merges second rebases and renumbers; `when` timestamp stays at original value so hash-based "already applied" detection works on dev.
6. **`skip-doc-drift` label** added as escape hatch for schema/script changes that don't affect user-visible doc pages. Re-runs need a fresh push (not just a rerun) to pick up labels.

---

## Next Session: Recommended Starting Point

Wave 3 is ready to dispatch. All `skip-doc-drift` pre-flight patterns are understood. Read `docs/superpowers/specs/2026-05-11-config-classification-design.md` for the migration targets, then dispatch:

```
Parallel (all independent, no DB collisions between them):
  FLX-221 — FLUXAOS_TARGET_REPO_PATH → project.targetRepoPath column
  FLX-222 — FLUXAOS_WORKSPACE_ROOT → config_entry
  FLX-223 — FLUXAOS_ARTIFACTS_ROOT → config_entry
  FLX-224 — FLUXAOS_CLEANUP_* (4 vars) → config_entry

After Wave 3 lands:
  FLX-207 + FLX-226, 227, 228, 229 — Projects form redesign
  FLX-231 — deploy-bridge.test.ts fixture fix
  FLX-233 — stash collision fix (add to CLAUDE.md / AGENT_BEHAVIOR.md)
```

Note for next agent: run `./flux env audit` at session start to verify dev/UAT DB split. If `DIRECT_URL` is not set in `.env.local`, migration scripts will refuse to run — it was added this session but confirm it's present.
