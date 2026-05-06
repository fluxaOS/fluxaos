# fluxaOS — Session Handoff
**Date:** 2026-05-06  
**Ended:** 2026-05-06T13:20:00Z  
**Model:** claude-sonnet-4-6  
**Branch:** main  
**HEAD:** b59913c  
**Session start boundary:** 2026-05-06T06:22:16Z (from session-start marker)

---

## What Was Accomplished

### Linear Audit Backlog — Shipped (FLX-139, FLX-150, FLX-151, FLX-134, FLX-152, FLX-155, FLX-156, FLX-157)

The full audit backlog was cleared this session across 10 merged PRs (#268–#277 + the gitignore fix #278):

- **FLX-139** — `stage-executor.ts` extracted from `event-orchestrator.ts` (714 → 275 lines). Four interdependent functions (`launchStage`, `applyVerdict`, `handleStageFailed`, `completePipelineRun`) moved into a factory closure. Dead `lastSignal` branch removed from `stage-runner.ts` (~86 lines). `event-orchestrator.ts` removed from pre-commit SIZE_EXEMPT_FILES.
- **FLX-150** — `export enum Feature` replaced with `export const Feature = {...} as const` + type alias, eliminating TypeScript enum runtime semantics.
- **FLX-151** — `applyVerdict` routing changed from reason-string gate (`if signalReason === 'already_complete'`) to data gate (`if targetStateKey`) — routing decision now belongs entirely to skill-declared data.
- **FLX-134** — `DEFAULT_PROMPT_TRANSPORT` and `DEFAULT_ISOLATION_PROVIDER` added to `constants.ts`; hardcoded `300_000` timeout replaced by `DEFAULT_STAGE_TIMEOUT_SEC * 1000`; `baseBranch = 'main'` default removed from worktree provider (now throws on missing).
- **FLX-152** — Closed without code change: the `stage.driver` error path bug was already resolved as a side effect of FLX-139 extraction.
- **FLX-155 + FLX-156** — `applyVerdict()` in `event-orchestrator.ts`: null/blank routing field now calls `finishRun(run, PIPELINE_RUN_STATUS.blocked)` with error event instead of silently calling `completePipelineRun`; unknown stage name caught and blocked instead of throwing unhandled.
- **FLX-157** — `TRPCError` in core services replaced with `NotFoundError` (typed domain error class), keeping `src/core/` free of server-layer imports.

### Earlier in the Session (from compacted context) — Also Shipped

- **FLX-130, FLX-131** — Router literal constants, provider/actor literal constants
- **FLX-132** — Routing sentinels extracted to typed constants
- **FLX-135** — StageGraphRunner DI port injection; removed direct langgraph imports from `src/core/`
- **FLX-136** — `node:fs` direct access replaced with injected ports
- **FLX-137** — DI violations eliminated; typed `NotFoundError` replacing string prefix matching
- **FLX-138** — Cleanup config injected via `FluxaosConfig`, fail-fast on missing vars
- **FLX-140** — `stage_run` writes moved from ingest script to orchestrator; result/signal fields cleaned up
- **FLX-141** — Data integrity fixes: transaction, optimistic lock, count query
- **FLX-142** — `config.list` scoped to `projectId` with ownership check
- **FLX-143** — Issue service `getById`/`delete`/`updateFields`/`transition` scoped to `projectId`; ownership checks added to remaining issue router procedures
- **FLX-144** — `crud-factory.list()` throws; scoped list added to all 7 affected services
- **FLX-145** — Ownership checks added to all pipeline run/stage run endpoints
- **FLX-146** — Server-side row filter added to `subscribeToTable` (Realtime)
- **FLX-148, FLX-149** — LAN bypass scoped to loopback; single-tenant assumptions documented
- **FLX-153, FLX-129, FLX-154** (prior session) — DB-first pipeline routing, persona soul injection, Personas tab

### Broad Code Review — 28 Issues Filed (FLX-158 through FLX-185)

Four parallel subagents reviewed the codebase for security, type safety, hardcoded values, and DRY violations. All findings filed as Linear issues:

**Type Safety (9 issues):**
- FLX-158 — `sha!` non-null assertion on uninitialized var in GitHub adapter (High)
- FLX-159 — `ingest-result-doc.ts` silently passes on missing `--result-doc` arg (High)
- FLX-160 — Bare cast on ingest output hides wrong-shape verdict (High)
- FLX-161 — `result-doc.ts` imports from `'zod'` not `'zod/v4'` (Medium)
- FLX-162 — `config.value as string` on jsonb (Medium)
- FLX-163 — `driverRow.defaultArgs as string[]` on jsonb can crash spawn (Medium)
- FLX-164 — `worktreeCopyFiles` element types not validated (Medium)
- FLX-165 — `maybeAutoCloseParent` unbounded recursion (Medium)
- FLX-166 — Realtime payload cast produces silent undefined fields (High)

**Security (5 issues):**
- FLX-167 — Zero auth on all core entity mutations (High)
- FLX-168 — Missing ownership checks on 3 read procedures (Medium)
- FLX-169 — Issue sub-router bypasses project scoping (Medium)
- FLX-170 — ReDoS from user-stored regex in routing resolver + gate engine (High)
- FLX-171 — Full `process.env` inherited by AI subprocesses (Medium)

**Hardcoded Values (5 issues):**
- FLX-172 — ACTOR constant group needed (Medium)
- FLX-173 — Config key strings inline across 6 files (Medium)
- FLX-174 — Issue lifecycle event types missing from `ISSUE_EVENT_TYPE` (Medium)
- FLX-175 — Adapter files bypass FluxaosConfig (Medium)
- FLX-176 — `RESULT_DOC_VERDICT` constant needed (Low)

**DRY (9 issues):**
- FLX-177 — `resolveProjectIdForRun` in 3 places (Medium)
- FLX-178 — `blockIssue` sequence copy-pasted 4× (Medium)
- FLX-179 — `resolveInitialState` ≡ `findNonTerminalState` (Medium)
- FLX-180 — `pipeline.list` ≡ `pipeline.listByProject` (Medium)
- FLX-181 — Ownership guard 8× in pipeline router (Medium)
- FLX-182 — Cancelled-check duplicated in success + catch paths (Medium)
- FLX-183 — `getNextStage` + `getCurrentStageRun` dead code (Low)
- FLX-184 — `resolveInitialStatusId` is a specialized duplicate (Low)
- FLX-185 — Stage-run enrichment loop duplicated (Medium)

### Infrastructure Fix
- PR #278 — `.gitignore` `.claude/skills/` negation moved after `.claude/` ignore rule (was being overridden by the later line, causing skill files to appear deleted)

---

## Issues Closed This Session

All FLX-130, FLX-131, FLX-132, FLX-134, FLX-135, FLX-136, FLX-137, FLX-138, FLX-139, FLX-140, FLX-141, FLX-142, FLX-143, FLX-144, FLX-145, FLX-146, FLX-148, FLX-149, FLX-150, FLX-151, FLX-152, FLX-155, FLX-156, FLX-157 closed/merged.

---

## Open PRs

None — all work merged to main.

---

## Known Blockers

None.

---

## Context Decisions This Session

- **`finishRun` stays in orchestrator** — it calls `terminalHook` which requires DI context not available to the `stage-executor` factory. Passed as a `StageExecutorDeps` dependency instead of being extracted.
- **FLX-151 routing change** — removed the `skillSignalReason === 'already_complete'` gate; routing is now purely data-driven (`if targetStateKey`). Reason string preserved in event payload for observability only.
- **Code review approach** — one focused subagent per domain (security, type safety, hardcoded values, DRY) running in parallel, not a single broad agent.

---

## Next Session: Recommended Starting Point

Large queue of new issues filed (FLX-158–185). Suggested order:

1. **FLX-159** — Quick win, safety critical: guard `ingest-result-doc.ts` arg missing path
2. **FLX-161** — One-line fix: `result-doc.ts` import `zod/v4`
3. **FLX-166** — Realtime payload snake_case→camelCase normalization (orchestrator silently fails on new runs)
4. **FLX-167** — Auth sweep: add `protectedMutation` to all unauthenticated mutation routers
5. **FLX-172 + FLX-173 + FLX-174** — Constants group (ACTOR, CONFIG_KEY, ISSUE_EVENT_TYPE) — these are grouped work, can batch in one PR
6. **FLX-177 + FLX-178** — DRY consolidations in orchestrator layer

Branch: `main` @ b59913c — clean, nothing in flight.
