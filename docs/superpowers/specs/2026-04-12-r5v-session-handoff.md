# R5-V: Manual Stage Execution — Session Handoff

**Date:** 2026-04-12
**From:** Brainstorming session (R4-V verified, R5-V designed and planned)
**To:** Next session (R5-V implementation)
**Supersedes:** `2026-04-11-r5v-manual-execution-handoff.md` (obsolete — that handoff was for a simpler approach that failed)

---

## What Happened This Session

1. **Verified R4-V** — Gate engine tested in browser. Rule builder, verdict badge, test panel all work. Gate modes (auto, rules, hold) evaluate correctly. R4-V marked Done in roadmap.

2. **Cleaned up stale data** — Found 9 orphaned pipeline runs from the reverted R5-V session (Apr 12). All showed "running" in the UI but had no actual processes. Nuked and re-seeded.

3. **Brainstormed R5-V design** — Full design session covering:
   - Harness catalog (match PAT's `v2_tools` schema exactly, no guessing)
   - Skill materialization (DB → disk, full pipeline, not deferred)
   - Event-driven orchestrator (Supabase Realtime, not LLM polling)
   - PAT-style RunDetailModal with full parsed transcript
   - Crash recovery with restart-unless-stopped semantics
   - Complete audit trail (every orchestrator action writes to DB)

4. **Wrote spec + plan** — 15-task implementation plan with full file map.

5. **Key decisions made by user:**
   - **No fallbacks, ever.** One path. If it doesn't work, fix it.
   - **No hardcoding, ever.** Everything from DB, even for dev/testing.
   - **Full materialization pipeline now.** Not deferred, not simplified.
   - **Match PAT's `v2_tools` exactly.** Previous attempt guessed at the schema and got it wrong.
   - **Supabase Realtime for streaming.** Not SSE. Not polling.
   - **Gate verdict drives advancement.** Not hardcoded human action.
   - **Restart-unless-stopped.** Cancelled stages are never re-launched.

---

## Documents to Read (in order)

1. **CLAUDE.md** — Session protocol, invariants, workflow
2. **Spec:** `docs/superpowers/specs/2026-04-12-r5v-manual-execution-design.md` — Full design with schema, execution flow, audit trail, UI components
3. **Plan:** `docs/superpowers/plans/2026-04-12-r5v-manual-execution-plan.md` — 15 tasks, step-by-step with file map
4. **RCA:** `docs/rca/2026-04-12-r5v-session-failure-rca.md` — What went wrong last time. Read this. Don't repeat it.
5. **PAT reference files** (listed below)

---

## What Exists Now (after revert + cleanup)

### Backend (survived the R5-V revert)

| Component | File | Status | Notes |
|-----------|------|--------|-------|
| Orchestrator Manager | `src/core/orchestrator/manager.ts` | **Replace** | Heartbeat-based polling, needs to become event-driven |
| Pipeline Run Service | `src/core/orchestrator/pipeline-run-service.ts` | **Keep** | DB lifecycle management, functional |
| Routing Resolver | `src/core/orchestrator/routing-resolver.ts` | **Keep** | Resolves provider/model, functional |
| Stage Worker | `src/core/orchestrator/stage-worker.ts` | **Replace** | Coupled to BullMQ pattern, new orchestrator handles this |
| Subprocess Executor | `src/adapters/subprocess/executor.ts` | **Keep** | execa wrapper, functional, used by new orchestrator |
| tRPC Pipeline Router | `src/server/routers/pipeline.ts` | **Edit** | Needs orchestrator trigger wiring, cancel mutations |
| Orchestrator Types | `src/core/orchestrator/types.ts` | **Keep** | Complete |
| Integration Tests | `src/__tests__/integration/orchestrator.test.ts` | **Keep** | 13 tests passing, add more |

### Frontend (survived)

| Component | File | Status |
|-----------|------|--------|
| Issue detail with "Run Stage" | `src/app/.../issues/[number]/client.tsx` | **Edit** — add RunDetailModal |
| Pipeline runs list | `src/app/.../pipelines/page.tsx` | **Keep** |
| Pipeline run detail | `src/app/.../pipelines/[id]/page.tsx` | **Edit** — add RunDetailModal |
| Pipeline settings with gate UI | `src/app/.../settings/page.tsx` | **Edit** — add skill + harness dropdowns |
| VerdictBadge | `src/components/gates/VerdictBadge.tsx` | **Keep** — reuse in GateResultsPanel |
| RuleBuilder | `src/components/gates/RuleBuilder.tsx` | **Keep** |
| RuleTestPanel | `src/components/gates/RuleTestPanel.tsx` | **Keep** |

### What Does NOT Exist (must be built)

| Component | File | Why |
|-----------|------|-----|
| harness_catalog table | Schema + migration | PAT's `v2_tools` equivalent — no hardcoded harness commands |
| Skill materializer | `src/core/skills/materializer.ts` | DB → disk workspace for harness |
| Command builder | `src/core/orchestrator/command-builder.ts` | Assemble CLI from harness_catalog config |
| Event-driven orchestrator | `src/core/orchestrator/event-orchestrator.ts` | Supabase Realtime subscriptions, state machine |
| Output parser | `src/core/orchestrator/output-parser.ts` | stdout → typed TranscriptEntry |
| RunDetailModal | `src/components/pipeline/RunDetailModal.tsx` | PAT-style modal |
| LiveOutput | `src/components/pipeline/LiveOutput.tsx` | Real-time transcript via Realtime |
| GateResultsPanel | `src/components/pipeline/GateResultsPanel.tsx` | Gate verdict display |
| StageTimeline | `src/components/pipeline/StageTimeline.tsx` | Vertical stage list with status dots |
| PipelineStatusBadge | `src/components/pipeline/PipelineStatusBadge.tsx` | Colored status badge |
| Harness tRPC router | `src/server/routers/harness.ts` | CRUD for harness catalog |

---

## PAT Reference Files

These are the source of truth for how things should work. Read them before building.

| What | PAT File | What to Learn |
|------|----------|---------------|
| Modal layout | `/mnt/dev/pat/frontend/src/components/RunDetailModal.tsx` | Header, sidebar, right panel, tabs, data flow |
| Live output | `/mnt/dev/pat/frontend/src/components/LiveOutput.tsx` | Transcript entry types, toolbar, raw/parsed modes |
| Harness schema | `/mnt/dev/pat/src/pat/core/orchestrator/models/providers.py` | `v2_tools` model — match field-for-field |
| Stage launcher | `/mnt/dev/pat/src/pat/core/orchestrator/stage_launcher.py` | How command is built, prompt transport, workspace |
| Routing resolver | `/mnt/dev/pat/src/pat/core/orchestrator/routing_resolver.py` | How routing is resolved from DB rules |
| Skill sync | `/mnt/dev/pat/.runtime/fh-commons/src/fh_commons/cli/sync/core.py` | Materialization pattern (SKILL.md files) |

---

## Schema Changes Summary

**New table:** `harness_catalog` — 15 columns matching PAT's `v2_tools` exactly (name, slug, binary, modelFlag, dirFlag, sessionNameFlag, promptTransport, promptFlag, issuePromptTemplate, queuePromptTemplate, defaultArgs, envVars, version, createdAt, updatedAt)

**pipeline_stage additions:** `skillId` (FK → skill), `harnessId` (FK → harness_catalog)

**stage_run additions:** `attempt` (int), `pid` (int), `exitCode` (int), `skillId` (FK → skill), `harnessId` (FK → harness_catalog)

**skill table:** verify `promptTemplate` field exists

---

## Critical Constraints (from user)

These are non-negotiable. The user was explicit about every one:

1. **No fallbacks.** Not "SSE with polling fallback." Not "preferred with fallback." One path. If it breaks, fix it.

2. **No hardcoding.** Every value comes from DB. Stage names, skill names, harness binaries, flags, templates — all from DB. Even for dev/testing. Seed data is fine; hardcoded logic is not.

3. **Match PAT exactly for harness schema.** The previous R5-V attempt guessed at the schema and added fields piecemeal after the user caught it. This time: read PAT's `v2_tools`, match it field-for-field, done.

4. **Full materialization.** Skills stored in DB, materialized to disk at execution time. Not deferred. Not simplified. The full pipeline.

5. **Supabase Realtime for output streaming.** Frontend subscribes to `event` table changes. No SSE endpoint. No polling.

6. **Gate verdict drives advancement.** The orchestrator doesn't hardcode "human reviews result." Gate rules from DB produce a verdict, the verdict determines the next action.

7. **Restart-unless-stopped.** On crash recovery, retry within budget. But if a human cancelled a stage, never re-launch it.

8. **Follow the skill chain.** `/implement` → `/review` (Codex) → `/rework` → `/deploy`. The previous session skipped this and it's the #1 root cause in the RCA.

---

## Execution Order

The plan has 15 tasks. Dependencies:

```
Task 1 (schema) → Task 2 (seed) → Task 3 (harness router)
Task 1 → Task 4 (command builder)
Task 1 → Task 5 (materializer)
Task 4 + Task 5 + Task 6 (output parser) → Task 7 (orchestrator)
Task 7 → Task 8 (StatusBadge + Timeline)
Task 7 → Task 9 (LiveOutput)
Task 7 → Task 10 (GateResultsPanel)
Task 8 + Task 9 + Task 10 → Task 11 (RunDetailModal)
Task 3 → Task 12 (settings UI)
Task 11 → Task 13 (wire into pages)
Task 7 + Task 13 → Task 14 (integration tests)
All → Task 15 (full verification)
```

Tasks 4, 5, 6 can run in parallel after Task 1.
Tasks 8, 9, 10 can run in parallel after Task 7.

---

## How to Start

```
Resume the fluxaOS rebuild. Phase R5-V: Manual Stage Execution.

Read these documents FIRST (in order):
1. CLAUDE.md — session protocol, invariants
2. docs/superpowers/specs/2026-04-12-r5v-manual-execution-design.md — the spec
3. docs/superpowers/plans/2026-04-12-r5v-manual-execution-plan.md — the plan (15 tasks)
4. docs/rca/2026-04-12-r5v-session-failure-rca.md — what went wrong last time

Then invoke /implement to start the skill chain. Do NOT start editing files directly.

PAT reference at /mnt/dev/pat/ — read the PAT files listed in the plan before building each component.
```

---

## Anti-Patterns to Avoid

From the RCA and this session's discussion:

1. **Don't guess at schemas.** Read PAT's model, match it. If something is unclear, ask.
2. **Don't skip the skill chain.** `/implement` first. Not "let me just edit this one file."
3. **Don't commit without testing.** `tsc --noEmit` is not testing. Run the code in a browser.
4. **Don't build fallbacks.** If Realtime doesn't work, debug Realtime. Don't add polling "just in case."
5. **Don't hardcode values.** If you're typing a stage name, skill name, or harness binary in app code (not seed data), you're doing it wrong.
6. **Don't simplify for convenience.** The user explicitly rejected "simplified for testing." Build it right.
7. **Don't write existing files.** Use Edit. The Write guard hook will block you anyway.
8. **Don't self-certify.** Every phase needs human verification in a running browser.
