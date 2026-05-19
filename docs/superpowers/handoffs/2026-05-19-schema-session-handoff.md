# fluxaOS — Session Handoff

**Date:** 2026-05-19  
**Model:** claude-sonnet-4-6 (1M context)  
**Session start:** 2026-05-19T04:22:37Z  
**Branch at close:** main  
**HEAD:** `6253cb7`  
**Session boundary:** session-start marker at `2026-05-19T04:22:37Z`

---

## What was accomplished

### Backlog clearance (early session)

The session opened on a clean queue after the previous session's audit sweep. Three items from the residual open queue were closed immediately:

- **FLX-257** (docs truth surface after DB config migration) — PR #377 was already green and waiting. Merged, branch pruned, Linear marked Done.
- **FLX-256 / seed proof cleanup** — PR #379 was a draft with CI failures. Rebased onto current main (upstream lint fixes absorbed the break), promoted, merged.
- **FLX-258** (E2E proof gate clarification) — A parallel agent had already drafted PR #380 while this session worked. Resolved an add/add conflict on `.claude/hooks/permission-request-allowlist.py` (kept fhc-template canonical version). PR #381 with the clean rebase merged.

### FLX-233 — Ban `git stash` in agent workflows

Full slice: brainstorm → spec → plan → review → implement → merge. **PR #382.**

`git stash` writes to a single shared `refs/stash`; agent B can pop agent A's stash silently. Solution: agents use temp commits instead. Changes landed to CLAUDE.md (new rule + 3 commit-based recipes), AGENT_BEHAVIOR.md, `ops/git-hooks/session-audit.sh` (reclassified advisory vs protected stash), `ops/git-hooks/pre-push` (blocks on advisory stashes). Pre-existing WIP stashes relabeled `PROTECTED:` in-tree (tree SHAs preserved).

### FLX-239 — Tenancy + waterfall config redesign

**The session's core work.** Four nested phases:

**Phase A — Spec + epic plan (PRs #383, #384)**

Full brainstorm with the user: customer→org→team→user→project SaaS hierarchy, M:N memberships, UUID-only URLs, Kopia-style waterfall config for every feature row (persona/skill/model/harness/etc). Documented the Kopia analogy explicitly.

Epic plan written (`docs/superpowers/plans/2026-05-18-tenancy-waterfall-epic.md`), then reviewed 4 rounds by fresh subagents before reaching `proceed` verdict. 10 real migration bugs caught pre-implementation: brand.org_id ADD COLUMN collision, Phase 12 NOT NULL ordering, missing statement-breakpoints, missing intra-scope partial indexes, etc.

**Phase B — Stage 1 slice plan (PR #384 + review)**

Detailed TDD slice plan (`docs/superpowers/plans/2026-05-18-flx-239-stage-1-schema.md`), 4 rounds of plan-review catching additional issues (trigger `OF team_id` clause, Phase 8 NOT NULL guard, granular spec skips, partial index coverage for all 4 scope layers, statement-breakpoint requirement).

**Phase C — Stage 1 execution (PR #385)**

7-task implementation via subagent-driven-development:

1. RLS policy audit → 0 policies reference team/team_member → no DROP POLICY needed.
2. Drizzle schema rewrite (`schema.ts`) → new tenancy tables, waterfall scope columns on 6 feature tables, updated relations.
3. Migration SQL → 15-phase hand-written migration.
4. Smoke tests → nuke + migrate clean; trigger smoke PASS; CHECK constraint smoke PASS.
5. Nuke script → added `customer` + `project_member`.
6. E2E skips → 3 specs marked `test.skip(...)` with FLX-239 reference.
7. Final verify + PR → pushed and opened.

Two hiccups during execution, both caught and fixed:
- First `db:migrate` silently no-op'd because the migration lacked `--> statement-breakpoint` markers. Drizzle requires these to split the file; without them only the first statement ran.
- Biome auto-format reformatted `test.describe.skip(...)` to split across two lines + reflowed `organizationRelations`. Added a style commit.

PR #385 merged with CI's `Type check` step RED — the 37 downstream files (routers, integration tests, app pages) that consume the old shape produce ~49 tsc errors. This is intentional and documented in the plan; Stages 2-6 progressively repair the downstream consumers. Force-merge was user-authorized.

---

## Issues closed this session

| Issue | Title | PR |
|---|---|---|
| FLX-257 | Reconcile fluxaOS docs truth surface | #377 |
| FLX-258 | Clarify deploy-touching E2E proof gate | #381 |
| FLX-233 | Ban git stash in agent workflows | #382 |

FLX-239 is still **In Progress** — Stage 1 merged but Stages 2-8 remain.

---

## Issues still in progress

| Issue | Status | Where |
|---|---|---|
| FLX-239 | In Progress (Stage 1 merged, Stage 2 next) | main @ 6253cb7 |

---

## Open PRs

None — all session PRs merged.

---

## Known state on main

CI is **RED on Type check** for main as of `6253cb7`. This is expected per the epic plan. Every CI check except `Type check` passes. The tsc red flag will persist until Stage 6 (feature-table consumer migration) lands.

---

## Three PROTECTED stashes on the repo

Three old `WIP:` stashes inherited from prior sessions were relabeled `PROTECTED:` (FLX-233) with tree SHAs preserved:
```
stash@{0}: PROTECTED: pre-existing project router change
stash@{1}: PROTECTED: pre-existing in-progress work (langgraph/orchestrator)  
stash@{2}: PROTECTED: pre-existing worktree changes (drizzle/realtime/orchestrator)
```
These are NOT this session's work and should not be dropped without inspecting the content.

---

## Context decisions this session

1. **customer = billing/identity only, not in URL or scope queries** — Customer table is a placeholder; no routers/UI/auth depend on it until a billing epic (est. ~6 months out). `organization.customer_id` is a nullable column with no FK.

2. **URL shape = `/p/{uuid}/...`** — UUID-only, no slugs, no org/team in URL. Display names are free-text. Slug uniqueness questions are eliminated.

3. **Waterfall is uniform = Kopia-style** — Every feature row (persona, skill, provider, driver, brand, routingProfile) follows the same 5-layer cascade: project → user → team → org → catalog. Single `resolveScoped<T>()` helper owns all reads.

4. **model and routingRule are NOT in the waterfall** — They're child rows of provider/routingProfile (NOT NULL FK to parent) and inherit scope through their parent. Adding independent scope columns would create ambiguity.

5. **Force-merge with red CI** — User explicitly authorized merging Stage 1 with the Type check step red. Stages 2-6 will repair the downstream tsc errors incrementally.

6. **`db:generate` is unusable on this codebase** — Pre-existing meta-snapshot drift in `drizzle/meta/` causes drizzle-kit to abort. All migrations are hand-written per established repo pattern (this pattern predates this session; last 11 migrations before Stage 1 were also hand-written). Stage 2 plan should document this up front.

---

## Unfinished work

| Item | Status |
|---|---|
| FLX-239 Stage 2 (seed rewrite) | Not started. Slice plan to be written next session. |
| FLX-239 Stages 3-8 | Blocked on Stage 2 completion (hard sequential). |
| FLX-203 (Settings IA consolidation) | Backlog; brainstorm first |
| FLX-206 (Playwright enforcement) | Blocked on fhc verify gate |

---

## Next session: recommended starting point

```
# Resume point — 2026-05-19 session
# Branch: main @ 6253cb7 (clean)
# CI: tsc RED on main (expected; 49 errors in downstream consumers)
#
# FLX-239 Stage 1 shipped. All stages 2-8 still ahead.
# Next: write Stage 2 slice plan (seed rewrite).
#
# Key fact for Stage 2 plan:
#   - db:generate is broken (meta snapshot drift); migrations are hand-written
#   - Seed currently inserts project with userId + persona with scope
#     → these fail at INSERT after Stage 1 schema changes
#   - Stage 2 must: (1) fix seed inserts, (2) add verify:seed assertions
#     for auth-identity invariant and project.org_id === team.org_id,
#     (3) seed should restore a green CI tsc step (seed.ts errors gone)
#
# /implement FLX-239 Stage 2 OR
# superpowers:writing-plans for Stage 2 slice plan

cd /mnt/dev/fluxaos
# Stage 2 epic guidance: docs/superpowers/plans/2026-05-18-tenancy-waterfall-epic.md
# Stage 1 slice (for reference): docs/superpowers/plans/2026-05-18-flx-239-stage-1-schema.md
```
