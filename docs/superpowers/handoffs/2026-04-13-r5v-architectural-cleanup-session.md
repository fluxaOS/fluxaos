# R5-V Architectural Cleanup + Browser Verification — Session Handoff

**Date:** 2026-04-13, ~4:30 AM PDT
**Branch:** `phase/r5v-manual-execution` → merged to `main` via PR #20
**Previous session:** [R5-V Architectural Cleanup Handoff](2026-04-13-r5v-architectural-cleanup-handoff.md)

---

## What This Session Did

1. **Executed the 14-task architectural cleanup plan** — 4-layer bottom-up refactor (constants → shared services → shared execution → consumer cleanup)
2. **Browser-verified the full pipeline lifecycle** — research → implement → review → deploy → complete, all tested manually
3. **Found and fixed 6 bugs during verification** — LiveOutput event filter, parsed output rendering, skill content loading, deploy skill stubs, seed data gaps, state transition architecture
4. **Made a critical architectural decision** — the orchestrator must NOT auto-advance issue state; the skill owns that decision
5. **Synced real skills from fh-commons** — replaced stub skills with full rendered versions (implement, review, deploy)
6. **Identified the key missing piece** — skill-to-orchestrator IPC protocol (R5.5)

---

## Architectural Cleanup Summary (14 Tasks)

| Layer | What | Key Files |
|-------|------|-----------|
| L1 | Constants module + types re-export | `src/core/constants.ts`, `types.ts` |
| L2 | PipelineRunService consolidation | `pipeline-run-service.ts` |
| L3 | Schema migration (contextLayout), harness-agnostic materializer, shared stage-runner | `schema.ts`, `materializer.ts`, `stage-runner.ts` (new) |
| L4 | Event-orchestrator vendor fix, manager.ts deleted, routing fail-fast, gate/UI constants, cleanup | `event-orchestrator.ts`, `routing-resolver.ts`, `seed.ts`, UI components |

**Net result:** ~530 lines deleted from event-orchestrator, 430 lines deleted (manager.ts), shared `executeStageRun()` eliminates duplication. No Supabase imports in `src/core/`. No `'subprocess'` fallback.

---

## Browser Verification Results

| # | Check | Result |
|---|-------|--------|
| 1 | Settings: skill + harness dropdowns | Pass |
| 2 | Assign skill + harness to stage | Pass |
| 3 | Issue detail: "Run Stage" | Pass |
| 4 | StageTimeline status dots | Pass |
| 5 | LiveOutput streams transcript | Pass (batching deferred) |
| 6 | Raw/parsed toggle, copy | Pass |
| 7 | Gate evaluation | Pass (verdict correct, rule display deferred) |
| 8 | Cancel button | Not tested (needs active run timing) |
| 9 | Pipeline detail modal | Pass |
| 10 | Activity feed events | Deferred (no auto-refresh) |

**Full pipeline lifecycle verified:** Issue #1 ran through all 4 stages (research, implement, review, deploy), gates fired on implement stage with `proceed` verdict, issue reached `complete` state with `isClosed=true`.

---

## Bugs Found and Fixed

1. **LiveOutput event filter** — UI filtered for uppercase event types (`OUTPUT`, `STAGE_STARTED`) but DB stores lowercase (`output`, `launched`). Fixed by using `EVENT_TYPE` constants.
2. **Parsed output not rendering** — plain text from `--print` mode parsed as `raw` entries which weren't visible in default mode. Fixed by promoting `raw` → `text` kind.
3. **Seed skill content** — hardcoded "Research the following topic thoroughly" instead of loading from `.claude/skills/research/SKILL.md`. Fixed to read from disk.
4. **Deploy skill was a stub** — 1,836 byte hand-written stub that asked for human review. Replaced with 23,674 byte rendered version from fh-commons that runs autonomously.
5. **Implement/review skills were stubs** — same issue, replaced with full rendered versions.
6. **Auto state transition was wrong** — orchestrator blindly advanced state on exit code 0. Removed — the skill owns state decisions.

---

## Critical Architectural Decision

**The orchestrator must NOT auto-advance issue state.** This was implemented, tested, found to be wrong, and removed in the same session.

Why it's wrong:
- Exit code 0 means "ran without crashing", not "advance to next stage"
- The skill may find work is already done (research found the health endpoint was already implemented)
- The skill may decide to hold, rework, or skip — only it knows the right next state
- In PAT, skills call `pat pipeline exit --status <status>` to signal their decision

**Implication:** fluxaOS needs a skill-to-orchestrator IPC protocol (R5.5). The systemd daemon is the single DB writer. Skills cannot write to the DB directly. Need a mechanism for skills to communicate decisions back.

---

## Deferred Fixes

Full list in `docs/superpowers/deferred-fixes.md`. Key items:

| Priority | Issue |
|----------|-------|
| **High** | Skill-to-orchestrator IPC protocol not defined |
| **Medium** | LiveOutput batches output instead of streaming |
| **Medium** | Issue activity feed no auto-refresh via Realtime |
| **Medium** | Previous run details not visible after new run |
| **Medium** | Skill edit/delete missing from settings UI |
| **Low** | GateResultsPanel rule detail dots empty |
| **Low** | Cancel button untested |
| **Low** | Closed issues show "Complete" not "Closed" |
| **Low** | RealtimeProvider adapter not implemented |

---

## What's Next

1. **R5.5 — Design skill-to-orchestrator IPC protocol** (brainstorming session)
   - How do skills signal completion, state transitions, results back to the orchestrator?
   - Options: structured stdout JSON, file-based result, local API endpoint
   - Must respect single-writer principle (only systemd writes to DB)
   
2. **R-UI — Mockup reconciliation** — harness catalog page, skill CRUD, real-time updates

3. **R6 — Polish + ship**

---

## Roadmap Status

| Phase | Status |
|-------|--------|
| R1–R4 | Done |
| R5-V | **Done — PR #20 merged** |
| R5.5 | Not started — needs design session |
| R-UI | Not started |
| R6 | Not started |
