# fluxaOS Session Handoff
**Date:** 2026-05-06  
**Model:** claude-sonnet-4-6  
**Branch:** main  
**Commit:** c1050ba  
**Session boundary:** session-start marker 2026-05-06T~06:27 PDT

---

## What Was Accomplished

### Wave 1 — Critical Type Safety (PRs #280–282)
- **FLX-159** (#280): `ingest-result-doc.ts` — exit 1 when `--result-doc` flag has no following value (was falling into try/catch as "unreadable", masking driver misconfiguration)
- **FLX-161** (#281): `result-doc.ts` — fix lone `'zod'` import to `'zod/v4'` (eliminated dual Zod instance)
- **FLX-166** (#282): `event-orchestrator.ts` — replace lying `as typeof pipelineRun.$inferSelect` Realtime payload cast with proper `PipelineRunRealtimeRow` interface (Realtime delivers snake_case, not camelCase)

### Wave 2 — Security + High-Priority Type Safety (PRs #283–286)
- **FLX-158** (#283): GitHub adapter — eliminate `sha!` non-null assertion on uninitialized variable; add explicit `throw` after `wrapOctokitError` so compiler tracks definite assignment
- **FLX-160** (#284): `stage-executor.ts` — replace bare `JSON.parse(...) as IngestOutput` cast with `IngestOutputSchema.parse()`; invalid shapes now fail loudly instead of silently writing bad verdicts
- **FLX-167** (#285): Auth sweep — replace `publicProcedure` with `protectedMutation` on all create/update/delete mutations across 9 routers (Provider, Pipeline, Project, Brand, Persona, Cron, Team, Config, IssueCatalog); LAN bypass preserved; roles: `EDIT_ROLES` for creates/updates, `DELETE_ROLES` for deletes
- **FLX-170** (#286): ReDoS fix — validate user-stored regex at write-time (Zod `.refine()` + 500-char cap) and wrap `new RegExp(pattern).test()` in try/catch at use-time in routing-resolver and gate engine

### Wave 3 — Constants + Hardcoded Values (PR #287)
- **FLX-172+173+174** (#287): Added `ACTOR`, `CONFIG_KEY` constant groups to `constants.ts`; extended `ISSUE_EVENT_TYPE` with 5 lifecycle events; replaced 38+ inline string literals across 7 files

### Wave 4 — Security + Type Safety (PRs #288–290)
- **FLX-165** (#288): `maybeAutoCloseParent` — add `depth = 0` parameter with limit of 50 to prevent stack overflow from circular parent FK
- **FLX-162+163+164** (#289): jsonb cast safety — `config.value` throws on non-string; `driverRow.defaultArgs` validates array-of-strings before spawn; `worktreeCopyFiles` filters non-string elements
- **FLX-168+169** (#290): Ownership checks on read procedures — `pipeline.issueState`, `runs.list`, `runs.listByProject`; `issue.getChildren`, `hasOpenChildren`, `transitions`, `comment.*`

### Wave 5 — DRY + Adapter DI (PRs #291–293)
- **FLX-179+185** (#291): Consolidate `resolveInitialState` → `findNonTerminalState`; extract `enrichStageRuns` helper shared by pipeline-run-history and pipeline router
- **FLX-176+183+184** (#292): Add `RESULT_DOC_VERDICT` constant; delete dead `getNextStage`/`getCurrentStageRun` methods (zero callers); remove `resolveInitialStatusId` duplicate
- **FLX-175** (#293): Wire `FLUXAOS_ARTIFACTS_ROOT`/`FLUXAOS_WORKSPACE_ROOT` through `FluxaosConfig` DI instead of direct `process.env` reads in 3 adapter files

### Wave 6 — DRY Refactors (PRs #294–297)
- **FLX-181** (#294): Extract `assertRunOwnership`/`assertStageRunOwnership` helpers in pipeline router; replace 8 copy-pasted ownership guard sequences (net −44 lines)
- **FLX-177** (#295): Extract shared `resolveProjectIdForRun(db, runId)` helper in `run-helpers.ts`; consolidate 3 parallel implementations
- **FLX-180+182** (#296): Delete `pipeline.listByProject` (byte-for-byte duplicate of `pipeline.list`); extract `buildCancelledResult` helper in stage-runner
- **FLX-178** (#297): Extract `blockIssueOnRun` helper in `run-helpers.ts`; replace 4 copy-pasted block sequences in stage-executor and manual-run

### Wave 7 — Security (PR #298)
- **FLX-171** (#298): Scope subprocess env to OS/shell allowlist (`PATH`, `HOME`, `TERM`, `LANG`, `LC_*`, `XDG_*`, `NODE_ENV`, etc.); strip `FLUXAOS_*`, `ANTHROPIC_API_KEY`, `SUPABASE_*` from subprocess inheritance. **Bonus fix:** `providerApiKeyRef` was never being resolved into `params.env` — the subprocess was silently relying on `process.env` bleed. Now resolved explicitly in `stage-runner.ts`.

---

## Issues Closed This Session

All 28 issues from the code review (FLX-158–185) shipped and marked Done:

| Issue | Title | PR |
|-------|-------|----|
| FLX-159 | Guard missing --result-doc arg | #280 |
| FLX-161 | Fix zod/v4 import in result-doc.ts | #281 |
| FLX-166 | Fix Realtime snake_case cast | #282 |
| FLX-158 | Non-null assertion on uninitialized sha | #283 |
| FLX-160 | Bare cast on ingest output | #284 |
| FLX-167 | Auth sweep: protectedMutation | #285 |
| FLX-170 | ReDoS: user-stored regex unguarded | #286 |
| FLX-172 | ACTOR constant | #287 |
| FLX-173 | CONFIG_KEY constant | #287 |
| FLX-174 | ISSUE_EVENT_TYPE lifecycle events | #287 |
| FLX-165 | maybeAutoCloseParent depth limit | #288 |
| FLX-162 | config.value jsonb cast guard | #289 |
| FLX-163 | defaultArgs jsonb cast guard | #289 |
| FLX-164 | worktreeCopyFiles element filter | #289 |
| FLX-168 | Pipeline read queries ownership | #290 |
| FLX-169 | Issue sub-router project scoping | #290 |
| FLX-179 | resolveInitialState duplicate | #291 |
| FLX-185 | enrichStageRuns extraction | #291 |
| FLX-176 | RESULT_DOC_VERDICT constant | #292 |
| FLX-183 | Delete dead getNextStage/getCurrentStageRun | #292 |
| FLX-184 | resolveInitialStatusId duplicate | #292 |
| FLX-175 | Adapter env vars via DI | #293 |
| FLX-181 | assertRunOwnership helpers | #294 |
| FLX-177 | consolidate resolveProjectIdForRun | #295 |
| FLX-180 | pipeline.listByProject duplicate | #296 |
| FLX-182 | cancelled-check result duplicated | #296 |
| FLX-178 | blockIssueOnRun 4x copy-paste | #297 |
| FLX-171 | Full process.env to subprocess | #298 |

---

## Remaining Backlog

Only post-alpha roadmap/feature items remain:
- **FLX-7** — Design "Just Do It" mode (product decision needed)
- **FLX-88** — Linear research endpoint unavailable in Codex (tooling bug, external)
- **FLX-101** — Achievement badge/reward system (roadmap feature)
- **FLX-2** — CLI surface under `src/cli` (post-alpha feature)
- **FLX-102** — Internal dev build dogfood notes (standing intake thread, In Progress)

---

## Notable Context Decisions

1. **FLX-171 bonus fix:** `providerApiKeyRef` was never being resolved. The subprocess got the API key only because of the full `process.env` spread. Fixing the env scoping required also wiring the key through the explicit DI channel in `stage-runner.ts`. Both changes shipped together in #298.

2. **FLX-167 role model:** Chose `EDIT_ROLES` (admin|maintainer) for creates/updates and `DELETE_ROLES` (admin only) for deletes. LAN bypass (`FLUXAOS_LAN_AUTH_BYPASS=1`) returns `admin` role so Playwright tests still pass.

3. **pre-existing tsc error:** `src/app/[org]/[user]/[project]/pipelines/[id]/page.tsx` has a `gateMode` optional/null mismatch that pre-dates this session. Multiple subagents confirmed it on `main` before their branches. Not introduced by this work.

4. **`run-helpers.ts` became a shared home:** FLX-177 created it for `resolveProjectIdForRun`; FLX-178 extended it with `blockIssueOnRun`. Good candidate for future orchestrator helpers.

---

## Open PRs

None — all PRs merged.

---

## Next Session: Recommended Starting Point

The code review queue (FLX-158–185) is fully shipped. The remaining backlog is post-alpha features. 

Next concrete options:
1. **Pre-existing tsc error** in `pipelines/[id]/page.tsx` (`gateMode` null/undefined mismatch) — small targeted fix, file a Linear issue if not already filed
2. **FLX-7** (Just Do It mode) — product design, requires user decision
3. **Dogfood the hardened build** via FLX-102 — run a real pipeline and capture observations

```
Branch: main @ c1050ba
Next: address pre-existing tsc error in pipelines/[id]/page.tsx or pick FLX-7 for design
```
