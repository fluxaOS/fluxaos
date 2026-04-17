# R-UI-2 Planning Session Handoff — Spec + Plan only, no code shipped

**Date:** 2026-04-16
**Branch merged:** `feat/r-ui-2-realtime` → `main` (PR pending)
**Commits on branch:** 4 (all documentation)
- `d4aef3f` — R-UI-2 design spec v1
- `bc86dcd` — R-UI-2 implementation plan v1 (30 tasks)
- `decdd73` — R-UI-2 spec + plan v2 (21 DA findings addressed)
- `a606782` — R-UI-2 spec + plan v3 (12 additional DA findings addressed)

**Previous handoff:** [R-UI-1 Session D — code-review follow-ups](2026-04-17-r-ui-1-session-d-code-review-followups.md)

**Main HEAD after this session:** (merge SHA TBD at PR merge time)

---

## Executive summary

This session did NOT ship code. It produced the R-UI-2 design specification and implementation plan — two documents (518 + 2412 lines respectively) that together define the unshipped remainder of R5-V's approved spec, now scoped to finish via a vendor-agnostic `RealtimeProvider` adapter, BullMQ-backed orchestrator dispatch, systemd-managed service lifecycle, and crash-recovery reconciliation.

The session arc was:

1. **Prior-session verification.** Confirmed baseline state per Session D handoff: main at `e776bb3`, 10/10 seed verify, 118 passing + 4 skipped vitest, 1 pre-existing TS error, zero `local-dev` matches in `src/`, 4 intentional "formerly known as" clarifier lines.

2. **Brainstorming R-UI-2.** Discovered through iterative user correction that the phase is NOT a new design — it's the unshipped remainder of R5-V's 2026-04-12 spec, which already defined the realtime architecture, systemd service deployment, crash-recovery semantics, and exit criteria. R-UI-2's job is to finish R5-V.

3. **Design spec v1.** Drafted. Committed. User answered three open questions (subprocess re-attach deferred, user-level systemd with GTM-portability rules, fold-ins confirmed).

4. **Plan v1.** Drafted — 30 tasks across 7 phases.

5. **Design Adversary review round 1.** Two parallel DA agents (code-reviewer + code-architect) reviewed spec and plan. 21 findings: 7 CRITICAL, 10 IMPORTANT, 4 MINOR. Most critical findings were grounded in failure to verify against actual source code (e.g., `recoverOnStartup` already exists, registry API is `registry.get('executor')` not `getRegistry().get('stageExecutor')`, etc.).

6. **Spec + plan v2.** All 21 findings addressed. Re-committed.

7. **Design Adversary review round 2.** Caught 12 NEW findings introduced by v2 fixes themselves — mechanical mistakes applying v1 fixes without re-verifying target code (`import type` on Drizzle tables, layout.tsx Server Component vs client provider mismatch, test inserting NULL into `notNull()` column, BullMQ jobId dedup collision, `lockDuration` vs test window, etc.).

8. **Spec + plan v3.** All 12 new findings addressed. Final commit.

The branch now contains a design spec and implementation plan that have survived two rounds of adversarial review and are ground-truth-verified against the actual source. No code has been written. The next session opens with a clean baseline + these two documents + a 32-task plan (v3 renumbered slightly).

**What the next session should take away:** R-UI-2 is architecturally well-defined. The plan's task ordering matters — Phase 1 (port extensions + adapter) must land before Phase 2 (client-side integration) which must land before Phase 3 (orchestrator rewiring). Tasks are sized 2-5 minutes each. Every task ends with a commit. No self-certification is permitted — Task 32 Step 2 is non-skippable human verification.

---

## What shipped in this session

### Commits (4, all on `feat/r-ui-2-realtime`)

#### `d4aef3f` — docs: R-UI-2 design spec v1

Initial design spec at `docs/superpowers/specs/2026-04-16-r-ui-2-design.md`. Framed R-UI-2 as finishing R5-V's unshipped realtime plumbing + orchestrator activation. Included:
- Scope: `RealtimeProvider` adapter, client-side port migration, activity-feed subscription, duration tick, orchestrator-as-systemd-service, BullMQ dispatch, recovery routine, publication migration
- Out of scope: casing/tense cosmetic fixes, scheduled runs, RLS changes, Mission Control view, CLI parity for realtime
- 9 architectural principles (all inherited from invariants.md / R5-V spec)
- Architecture diagram showing browser + orchestrator sharing the same `RealtimeProvider` port
- Three resolved design decisions: D1 (BullMQ for durability, subprocess re-attach deferred), D2 (user-level systemd with GTM-portability rules), D3 (fold-in confirmed for GateResultsPanel fix, cancel verification, orchestrator test rewrite)

#### `bc86dcd` — docs: R-UI-2 implementation plan v1

First plan at `docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md`. 30 tasks across 7 phases, every task ends with a commit, TDD discipline, explicit file paths and code blocks.

#### `decdd73` — docs: R-UI-2 spec + plan v2 (21 DA findings addressed)

Consolidated DA review round 1:

**Spec v1 → v2 — 10 findings:**
| # | Severity | Finding | v2 Fix |
|---|---|---|---|
| 1 | CRITICAL | `recoverOnStartup` already exists (lines 345-391), spec framed it as "implement" | Reframed as REPLACE; shows current code; diffs old logic vs new |
| 2 | CRITICAL | `attempts: 1` contradicts Celery-durability claim | Changed to `attempts: 3` + exponential backoff; D1-resolution explains two independent retry budgets (BullMQ = infra, orchestrator = application) |
| 3 | CRITICAL | `subscribeToTable` port signature mismatch — 4-arg DSL vs 4-arg port with no filter | Port extended with `filter?: string`; all 3 subscription sites use 5-arg form; `ports/realtime.ts` added to Modified list |
| 4 | IMPORTANT | `getJob` returns null for failed-set jobs, ambiguous in branch (a) | Check `job.status IN ('active','waiting','delayed')`; null AND `failed` both fall through |
| 5 | IMPORTANT | Server-side event batching may be root cause | Verified `stage-runner.ts:299-317` writes per-line via `runService.appendEvent` in onStdout callback, NOT buffered; client-side fix sufficient |
| 6 | IMPORTANT | PID recycling not acknowledged | Branch (c) note added; outcome identical |
| 7 | IMPORTANT | Lazy WebSocket construction claim unverified | Documented; adapter constructs client lazily per `@supabase/ssr` behavior |
| 8 | IMPORTANT | `%h` in EnvironmentFile violates D2's own `$HOME` ban | Replaced with `__FLUXAOS_REPO_PATH__` / `__FLUXAOS_ENV_PATH__` placeholders, sed-substituted at install |
| 9 | MINOR | Port file missing from Modified list | Added |
| 10 | MINOR | Playwright systemctl DBUS requirement undocumented | Documented in CLAUDE.md edits |

**Plan v1 → v2 — 11 findings:**
| # | Severity | Finding | v2 Fix |
|---|---|---|---|
| 1 | CRITICAL | Migration journal idx was `5`, should be `4` (tag is `0005`, idx sequence is 0,1,2,3→4) | Distinguishes idx from tag; uses correct idx 4 |
| 2 | CRITICAL | `getRegistry().get('stageExecutor')` is wrong API | Verified: `bootstrap()` + `registry.get<T>('executor')` (key is `executor`, not `stageExecutor`); updated Task 17, 18 |
| 3 | CRITICAL | Cross-instance race in `handleStageTerminalStatus` | Added `hasGateBeenEvaluated(stageRunId)` DB-backed idempotency guard (turned out TOCTOU-racy — fixed properly in v3) |
| 4 | CRITICAL | `main.ts` in `src/core/` violates invariant 7 (imports `@supabase/*` directly) | New `src/adapters/supabase/server-client.ts` factory; `main.ts` imports the factory, never `@supabase/*` directly |
| 5 | IMPORTANT | `skillSignalReason` treated as stage_run column but doesn't exist there | Added `getSkillSignalReason` helper that reads from event payload |
| 6 | IMPORTANT | Task 27 only tested one of three recover branches | Three separate `it()` blocks: (a) BullMQ-has-job, (b) no-job-no-subprocess, (c) no-job-alive-subprocess |
| 7 | IMPORTANT | DBUS required for `systemctl --user` from Playwright | `hasSystemdUser` skip guard added to Tasks 27, 28 |
| 8 | IMPORTANT | Task 29 grep audit conflicted with Task 17's main.ts location | Resolved by CRITICAL 4 fix |
| 9 | IMPORTANT | Mock queue typecheck broken window (Tasks 12-26) | Port + adapter updated in same commit (Task 2); window eliminated |
| 10 | MINOR | `data-testid` additions split across commits | Consolidated into Phase 2 tasks |
| 11 | QUESTION | Orchestrator may race against `@r-ui-1` journey assertions on `pending` | No @r-ui-1 journey asserts `pending` state (they test CRUD); non-issue |

#### `a606782` — docs: R-UI-2 spec + plan v3 (12 additional DA findings addressed)

Consolidated DA review round 2 — these are NEW issues introduced by v2's fixes themselves:

**Spec v2 → v3 — 3 findings:**
| # | Severity | Finding | v3 Fix |
|---|---|---|---|
| S-C1 | CRITICAL | `executeStageRun` has no re-entry guard; BullMQ redelivery (attempts: 3) produces duplicate events on same stageRunId | Spec prescribes a status guard at top of `executeStageRun` — if status not `queued`/`launching`, return zero-duration no-op result. Skip with log. |
| S-C2 | CRITICAL | `lockDuration: 300_000` makes exit criterion 8 impossible within test window | Exit criterion 8 rewritten — test uses `systemctl --user restart` (graceful shutdown returns BullMQ lock immediately) not `kill -SIGKILL` (lock expiry would take 5 min). SIGKILL scenario is manual-testing only. |
| S-C3 | CRITICAL | `hasGateBeenEvaluated` is TOCTOU-racy; not actually cross-instance safe | Partial unique index on `event(stage_run_id) WHERE type='gate_checked'`. `appendEvent(gate_checked, ...)` wrapped in try/catch on unique_violation (SQLSTATE 23505). |

**Plan v2 → v3 — 9 findings:**
| # | Severity | Finding | v3 Fix |
|---|---|---|---|
| P-C1 | CRITICAL | `executeStageRun` needs status guard (from S-C1) | New Task 16b adds guard to `stage-runner.ts`. |
| P-C3 | CRITICAL | Unique index migration needed | Task 5 SQL extended with `CREATE UNIQUE INDEX IF NOT EXISTS event_gate_checked_per_stage_run ON event (stage_run_id) WHERE type='gate_checked'`. |
| P-C4 | CRITICAL | `import type { event|stageRun|issueEvent }` erases Drizzle table constants at runtime | Changed to value imports in Tasks 10, 11, 12. |
| P-C5 | CRITICAL | `src/app/layout.tsx` is Server Component, cannot directly host client providers | Task 9 targets `src/app/[org]/[user]/[project]/layout.tsx` (where `TRPCProvider` mounts), NOT root layout. `RealtimeContextProvider` goes INSIDE `TRPCProvider`. |
| P-C6 | CRITICAL | Task 3 test inserts `stageRunId: null` but column is `notNull()` | `beforeAll` creates real `pipeline_run` + `stage_run` FK chain; `afterAll` cleans up in reverse FK order. |
| P-C7 | CRITICAL | Branch (b) re-enqueue uses same jobId → BullMQ dedup silent no-op against failed-set jobs | Task 18 uses `${sr.id}-recovery-${Date.now()}` as jobId; bumps `stage_run.attempt` on the row. |
| P-M1 | MINOR | Install script hardcodes `${HOME}/.config/systemd/user` (contradicts D2) | `UNIT_DIR` parameterized via `FLUXAOS_SYSTEMD_DIR` env var with `XDG_CONFIG_HOME` fallback. |
| P-M3 | MINOR | `or` not in Drizzle imports of pipeline-run-service | Task 15 Step 2 explicitly instructs adding it. |
| P-M4 | MINOR | Task 15 had `tryClaimStageForTerminalHandling` pseudocode then "use this instead" | Pseudocode deleted; only `hasGateBeenEvaluated` remains. |
| P-M5 | MINOR | Dev server kill timing unspecified vs Task 29 nuke | Task 24 Step 0 documents lifecycle: kill BEFORE Task 29 to avoid tRPC cache vs dropped rows. |
| P-GRP | CORRECTNESS | `GateResultsPanel.tsx` current impl reads `r.field` etc. from `RuleResult` but shape is nested `{ rule: { field, operator, value, label }, passed, actual }` | Task 13 updates BOTH the TypeScript cast and the accessors; uses `rule.rule.field` / `.operator` / `.value`. |

---

## Current state

### Git

```
Branch:   feat/r-ui-2-realtime
Head:     a606782 docs: R-UI-2 spec + plan v3 — second DA pass, 12 findings addressed
Base:     e776bb3 (main, post-Session D)

Commits on branch: 4 (all documentation)
Working tree:      clean
Stashes:           none
Worktrees:         /mnt/dev/fluxaos only
```

### Test suite & build

**Unchanged from Session D handoff baseline.** This session committed ONLY documentation (0 source files changed). Therefore:

- Vitest: 118 passed + 4 skipped across 9 files (no change)
- Playwright: 6/6 `@r-ui-1` journeys pass (no change)
- Typecheck: exactly 1 pre-existing error (`events.ts:53`, Drizzle conditional-where; pre-R-UI-1)
- Seed verify: 10/10 PASS

No new tests. No new sources. No regressions possible — 0 source files touched.

### Documents produced

```
docs/superpowers/specs/2026-04-16-r-ui-2-design.md          518 lines
docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md 2412 lines
docs/superpowers/handoffs/2026-04-16-r-ui-2-planning-session.md (this file)
```

No other files changed.

### DEF entries

No new DEF entries. Existing DEF-001..007 remain unchanged — R-UI-2 folds in fixes for some items (GateResultsPanel, cancel verification, orchestrator test rewrite) rather than adding new deferrals.

---

## What R-UI-2 will deliver when executed

This is a preview, not a commitment — the plan is the authoritative source.

### Core deliverables (in scope)

1. **Vendor-agnostic Realtime plumbing**
   - `src/adapters/supabase/realtime.ts` — the ONE place Supabase Realtime SDK is called
   - `src/adapters/supabase/server-client.ts` — server-side Supabase client factory (isolates `@supabase/supabase-js` import)
   - `src/lib/realtime/{context.tsx, use-realtime.ts, use-now.ts}` — React context + hooks
   - Port extension: `RealtimeProvider.subscribeToTable` gets optional `filter?: string` parameter

2. **Client-side Realtime migration**
   - `LiveOutput.tsx`, `RunDetailModal.tsx`, `issue-detail/client.tsx` all consume `useRealtime()` instead of calling `supabase.channel()` directly
   - Stream-as-arrives via tRPC `setData` append (replaces refetch-on-INSERT batching)
   - Live duration tick via `useNow({ enabled: isRunActive })`

3. **Server-side orchestrator activation**
   - `src/core/orchestrator/main.ts` — orchestrator systemd entrypoint (zero direct vendor imports)
   - `src/core/orchestrator/worker-main.ts` — stage-worker systemd entrypoint
   - `event-orchestrator.ts` — accepts `queue: QueueProvider`, enqueues stages via BullMQ (not in-process execution), handles terminal status via Realtime UPDATE subscription, REPLACES `recoverOnStartup` with 3-branch algorithm
   - `stage-runner.ts` — adds re-entry guard for BullMQ redelivery safety
   - `stage-worker.ts` — thin BullMQ job handler calling `executeStageRun`
   - BullMQ configured with `attempts: 3` + exponential backoff for infra-level durability

4. **Systemd service packaging**
   - `scripts/systemd/fluxaos-orchestrator.service`, `fluxaos-stage-worker.service` — unit templates with `__FLUXAOS_REPO_PATH__` / `__FLUXAOS_ENV_PATH__` placeholders (GTM-portable)
   - `scripts/install-orchestrator.sh` — idempotent installer, parameterized via `FLUXAOS_SYSTEMD_DIR`

5. **Database migration**
   - `drizzle/0005_realtime_publication.sql` — explicit `supabase_realtime` publication for `event`, `stage_run`, `pipeline_run`, `issue_event` + partial unique index on `event(stage_run_id) WHERE type='gate_checked'` (exactly-once gate-eval idempotency)

6. **Testing**
   - 5 new Playwright journeys under `@r-ui-2` tag: `live-output-streams`, `activity-feed-auto-refreshes`, `cancel-running-stage`, `orchestrator-recovers-after-restart`, `bullmq-requeues-on-worker-restart`
   - `orchestrator.test.ts` unskipped, rewritten with Redis precondition + three `recoverOnStartup` branch tests
   - Realtime adapter integration test (3 cases: unfiltered delivery, filter respected, unsubscribe)

7. **Fold-ins (not deferred)**
   - `GateResultsPanel.tsx` rule-field rendering fix (current impl reads flat shape, actual shape is nested)
   - Cancel-button verification (only exercisable once orchestrator is live)
   - `orchestrator.test.ts` rewrite (moves from `.skip` to real tests)

### Out of scope (explicitly)

- Casing/tense inconsistency, "Closed" vs "Complete" label — cosmetic, separate pass
- Scheduled / cron-triggered runs — no use case
- RLS / auth changes — separate concern
- Wiring MANUAL runs through the orchestrator — R5-V's eventual direction; R-UI-2 keeps manual-run on direct path
- Mission Control dashboard view
- CLI parity for realtime

---

## Verification for next session

Since this session shipped only docs, verification is different from a code-shipping session. Run these in order:

### Step 1 — Baseline intact

Confirm the baseline from Session D handoff is unchanged:

```bash
cd /mnt/dev/fluxaos
git checkout main
git pull origin main
git status --short                               # expected: empty
git log --oneline -3                             # expected top: R-UI-2 docs merge (after PR merges)

# Environment
grep FLUXAOS_LAN_AUTH_BYPASS .env                # expected: =1
echo $REDIS_URL                                  # expected: set; Redis reachable (needed for R-UI-2 impl)

# DB + seed
npx tsx src/core/db/nuke.ts && npm run db:seed && npm run verify:seed
# expected: 10/10 PASS

# Tests
npx vitest run
# expected: 118 passed, 4 skipped, 9 files

# Typecheck
npx tsc --noEmit 2>&1 | grep -c "error TS"
# expected: 1 (pre-existing events.ts:53)

# Playwright (requires dev server)
npm run dev -- -H 192.168.54.101 -p 3003 &
sleep 10
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test --grep @r-ui-1
# expected: 6 passed in ~15s
kill %1; wait %1 2>/dev/null
```

### Step 2 — R-UI-2 documents present

```bash
ls -la docs/superpowers/specs/2026-04-16-r-ui-2-design.md
# expected: 518 lines, ~35 KB

ls -la docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md
# expected: 2412 lines, ~75 KB

grep -c "^### Task " docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md
# expected: 32 (Tasks 1-16, 16b, 17-30 — renumbered across v2/v3 iterations)

# Verify v3 is the committed version (should reference partial unique index + re-entry guard)
grep -c "CREATE UNIQUE INDEX" docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md
# expected: >= 1

grep -c "re-entry guard" docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md
# expected: >= 1 (Task 16b)
```

### Step 3 — Roadmap reflects R-UI-2 plan/spec

```bash
grep "R-UI-2" docs/superpowers/roadmap.md
# expected: row shows "Not started" status but WITH plan + spec links (not dashes)
```

### Step 4 — No code drift

```bash
# Zero source files changed during this session
git log --name-only e776bb3..HEAD -- 'src/**' 'e2e/**' 'drizzle/**' 2>/dev/null
# expected: empty output
```

If any of the above diverge from expected, investigate before starting R-UI-2 execution.

---

## Plan + spec locations (reference)

- Spec: `docs/superpowers/specs/2026-04-16-r-ui-2-design.md`
- Plan: `docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md`
- Roadmap: `docs/superpowers/roadmap.md` — R-UI-2 entry
- Deferred-fixes: `docs/superpowers/deferred-fixes.md`
- R5-V spec (parent): `docs/superpowers/specs/2026-04-12-r5v-manual-execution-design.md`
- R5-V plan (parent): `docs/superpowers/plans/2026-04-12-r5v-manual-execution-plan.md`
- Invariants: `docs/invariants.md`
- Terminology: `docs/terminology.md`
- Session D handoff (previous): `docs/superpowers/handoffs/2026-04-17-r-ui-1-session-d-code-review-followups.md`

---

## Known gotchas + warnings for the next session

### Mechanical / environmental

1. **Redis must be running and reachable before Phase 3 starts.** `REDIS_URL` in `.env` must point to a live instance. Task 29 integration tests have a precondition check that skips BullMQ-dependent tests if Redis isn't reachable — but Phase 3 implementation tasks (orchestrator + stage-worker) will fail at runtime without it.

2. **`FLUXAOS_LAN_AUTH_BYPASS=1` in `.env`** still required for all Playwright journeys. Unchanged from Session D.

3. **Dev server binds `192.168.54.101:3003`.** Never port 3000.

4. **Playwright journeys that call `systemctl --user`** require the shell to have `DBUS_SESSION_BUS_ADDRESS` set. Run from an interactive terminal on the homelab. If invoking from an npm script or CI, export: `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$(id -u)/bus`.

5. **Migration journal format matters.** Task 5 appends a 5th entry to `drizzle/meta/_journal.json` with `"idx": 4` (the sequential index), `"tag": "0005_realtime_publication"` (the migration filename). Don't conflate the two.

6. **`stage_run.skillSignalReason` is NOT a column.** Only `skillSignal` and `skillMetadata` exist on the row. The `skillSignalReason` helper in Task 17 reads from the most recent `completed`-type event payload.

7. **Drizzle table imports are VALUES, not types.** Task 10/11/12 imports `event`, `stageRun`, `issueEvent` — NOT `import type { ... }`. `typeof event.$inferSelect` requires the value to be present at runtime.

### Conceptual

8. **The architecture is two-actor.** Orchestrator and stage-worker are separate systemd services. Orchestrator never spawns subprocesses; stage-worker never makes routing decisions. They communicate only through DB + BullMQ.

9. **Two independent retry budgets.** BullMQ `attempts: 3` is infrastructure durability — re-runs SAME stageRunId from scratch on worker crash. Orchestrator `maxRetries` is application-level rework — creates NEW stageRunId on skill-level failure. They do not double-count because they operate on different stageRunId keys.

10. **`executeStageRun` re-entry guard is critical.** Task 16b adds a status check at top of `stage-runner.ts` — if the row isn't `queued`/`launching`, it's a stale redelivery; return no-op. Without this, BullMQ's `attempts: 3` redelivers would produce duplicate `launched`/`completed` events on crash paths.

11. **Exactly-once gate-evaluation is DB-enforced.** Partial unique index on `event(stage_run_id) WHERE type='gate_checked'`. Two orchestrator instances observing the same terminal UPDATE both try to insert; one succeeds, the other gets unique_violation (SQLSTATE 23505) and returns cleanly.

12. **`RealtimeContextProvider` mounts at the project-scoped layout**, not the root. Root layout is a Server Component (exports `metadata`). Project layout (`src/app/[org]/[user]/[project]/layout.tsx`) is where `TRPCProvider` lives and where realtime belongs.

13. **`GateResultsPanel.tsx` current implementation reads the wrong shape.** Stored `ruleResults[]` is `RuleResult[]` with shape `{ rule: { field, operator, value, label }, passed, actual }`. The current component reads `rule.field` directly — that's the flat shape, not the actual nested shape. Task 13 fixes both the TypeScript cast AND the accessors.

### Workflow

14. **The plan is an instruction, not a guide.** Tasks are pre-decomposed to 2-5 minutes. Each ends with a commit. Each shows exact file paths and code to write. Do not improvise task boundaries.

15. **No self-certification.** Task 32 Step 2 is a manual user-verification checklist. It is non-skippable. The invariant is absolute.

16. **Two rounds of DA review caught 33 findings across the two documents.** The plan is bulletproofed against the obvious failure modes, but implementation-time discoveries are still possible. If anything deviates from the plan during execution, stop and flag per invariant 22.

---

## Start instructions for the next session

1. Run the sanity-check commands in "Verification for next session" above. If anything diverges, investigate before proceeding.

2. Read the R-UI-2 design spec in full (`docs/superpowers/specs/2026-04-16-r-ui-2-design.md`, 518 lines). It's the authoritative source for WHAT R-UI-2 delivers.

3. Read the R-UI-2 implementation plan in full (`docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md`, 2412 lines). It's the authoritative source for HOW.

4. Read this handoff for the session-arc context and the list of v3 decisions that differ from earlier iterations.

5. Execute R-UI-2 via the `superpowers:subagent-driven-development` skill (recommended — fresh subagent per task, two-stage review between tasks). Alternatively `superpowers:executing-plans` for inline execution with checkpoints.

6. Work on branch `feat/r-ui-2-impl` (or similar). The prior `feat/r-ui-2-realtime` branch (this session's planning branch) merges to main via PR and can be deleted after merge.

7. After Phase 7 completes, user-driven manual verification per Task 32 Step 2. Human eyes-on in a real browser. No self-certification.

---

Good luck. The documents have been thoroughly attacked; implementation should be mechanical. When in doubt, flag rather than decide.
