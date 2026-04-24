# R-DAEMON — Implementation plan

**Date:** 2026-04-24
**Spec:** [`../specs/2026-04-24-r-daemon-design.md`](../specs/2026-04-24-r-daemon-design.md)

---

## Plan-phase reconciliation

Spec claims verified against the live codebase before task breakdown:

1. **`event-orchestrator.ts` exists at 455 LoC and is never invoked.** ✅ Confirmed via `grep -rln "createEventOrchestrator\|event-orchestrator" src/` → only self-references and `stage-runner.ts` (uses constants, not the factory). No `.start()` call anywhere. Spec's "wire up, don't rewrite" stance holds.
2. **BullMQAdapter is registered in bootstrap but has no call sites.** ✅ Confirmed via `grep -rn "queue\.enqueue\|queue\.process\|queueProvider\|registry.get.queue" src/` → zero hits in app code. Only references are the port interface and the adapter itself. Dead code. Spec's "leave in place, file DEF" stance holds.
3. **`pipeline.runs.trigger` calls `executeManualRun` fire-and-forget.** ✅ Confirmed via `src/server/routers/pipeline.ts` lines 131–183. The mutation creates the pipeline_run row, creates a stage_run at `launching`, emits a `launched` event, then spawns the executor inline. R-DAEMON removes the executor-spawn block and the pre-created stage_run; daemon owns that bookkeeping.
4. **`pipeline_run` has no `trigger_type` column; `stage_run.trigger` exists.** ✅ Confirmed via `src/core/db/schema.ts` line 112 (pipeline_run) and line 151 (stage_run.trigger). Spec R6's provenance resolution — use a `pipeline_event` / `event` append, not a new column — is the right shape. (The `event` table is the existing append-only log; see schema.ts line 519.)
5. **`recoverOnStartup()` function exists on `EventOrchestrator` and reads stage_runs in `running` status with PID-alive checks.** ✅ Confirmed via `event-orchestrator.ts` lines 371–413. Behavior is: find all stage_runs at `running`, check `sRun.pid` with `process.kill(pid, 0)`, fail the dead ones, retry if budget remains, otherwise finish the run via `finishRun` (which fires the terminal hook). No rewrite needed.
6. **`PipelineTerminalHook` is idempotent and safe to reuse across runs.** ✅ Confirmed via `pipeline-terminal-hook.ts` entire file. The hook takes `{ deployBridge, isolation, logger }` at factory time; no per-run state is closed over. Daemon constructs one instance at boot and passes it to the orchestrator.
7. **`CleanupScheduler`'s own docstring says "the orchestrator daemon owns process lifetime".** ✅ Confirmed via `src/core/cleanup/cleanup-scheduler.ts` line 118. The daemon binding is the intended consumer.
8. **Realtime adapter already supports `subscribeToTable(channelName, tableName, event, handler)`.** ✅ Confirmed — `event-orchestrator.ts` lines 102–124 subscribes to `pipeline_run` INSERT + UPDATE. Server-side usage is structurally the same as the existing Next.js server-side paths that touch the adapter. New concern: persistent server-side subscriber is novel. Mitigated by R2 periodic sweep + systemd Restart=always. Flagged as non-obvious risk §5.

**DEF-018 (biome format drift on main) is still open.** Plan does not fix it; new files must pass biome cleanly so we don't add to the drift. Pre-existing drift on other files is tolerated per spec §11 verification matrix.

**DEF-019 (drizzle meta snapshot drift) is still open.** Not triggered by this phase — no schema change.

**Plan-phase decisions on open questions (defaulted per AGENT_BEHAVIOR.md — no questions during a session):**

- **Logger location:** extract to `src/core/logger/console.ts`. Already used by tRPC trigger (`consoleLogger`) and `pipeline-terminal-hook.test.ts`. One instance, one factory. If the extraction uncovers test fixture issues, fall back to inlining inside `daemon.ts` and note in commit.
- **Daemon-ready sentinel for journey test:** daemon prints a line `"daemon.started orchestrator=running cleanup=<bool> recovery_sweep=<bool>"` to stdout on completion of the bootstrap sequence. Journey test does a regex wait for `/daemon\.started /` on the child process's stdout.
- **Provenance event for manually-triggered runs:** use the existing `event` table with a synthetic stage_run-scoped event. But `event.stage_run_id` is NOT NULL — can't append without a stage_run. Alternative: the daemon's `launchStage` already appends the `launched` event for each stage_run. That captures the launch. For *trigger* provenance, append to the trigger's log only — not a DB row. Trade: lose "who triggered this run" in the audit trail. Acceptable for alpha because `pipeline_run.trigger_type` is not a schema we're extending in this phase. Post-alpha: add the column.
- **Trigger → pending → daemon pickup latency:** no invented timeout. The Realtime path is the timer. If the daemon is running, pickup is ~100–300 ms. If the daemon is down, the run sits at `pending`. The UI will show `pending` indefinitely — that's the correct signal to the operator that the daemon is not running. R11 docs mention this as part of the operator runbook.
- **Tests against a real Redis instance:** not required. BullMQ is out of the code path; no test touches it.
- **Signal-handling double-SIGTERM:** second SIGTERM during drain forces `process.exit(130)`. Third does nothing special (Node's default handler runs).
- **In-flight drain polling cadence:** every 500ms poll `select count(*) from stage_run where status = 'running'`. No env var — this is a behavior-shaped rule (poll until zero or grace elapses), not a threshold.
- **Do we gate the daemon behind `FLUXAOS_DAEMON_ENABLED=1`?** No. If the operator runs `npm run daemon`, they enabled it. The systemd unit is the on/off switch.

---

## Task breakdown

### Wave 1 — Daemon skeleton + env validation

**T1.** Create `src/scripts/daemon.ts`. Imports `'dotenv/config'`, `bootstrap` from `@/config/bootstrap`, the registry, and the type imports for the adapters it resolves. Body:
1. Call `bootstrap()` (throws on missing required env vars — fail-fast).
2. Validate the R-DAEMON-specific env vars: `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` must be set and a positive integer — throw on missing. `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` is optional; parse-or-warn.
3. Log `daemon.booting` with the parsed config.
4. `console.log('daemon.started orchestrator=pending cleanup=pending recovery_sweep=pending')` — at this point the sentinel is a lie because we haven't wired anything yet; the final sentinel is emitted at the end of W2. For W1, the intermediate `daemon.booting` log is sufficient.
5. `await new Promise(() => {})` — keep the process alive until signal handlers (added in W3) terminate it.

**T2.** Add `"daemon": "tsx src/scripts/daemon.ts"` to `package.json` scripts.

**T3.** Run `npm run daemon` locally with `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS=30` set. Verify: process stays up, logs "daemon.booting", no crash. Ctrl-C kills it cleanly (Node's default SIGINT handler).

**Commit:** `R-DAEMON W1: daemon entrypoint + env validation`.

### Wave 2 — Wire orchestrator, cleanup, recovery

**T4.** Extract shared console logger into `src/core/logger/console.ts`. Export `consoleLogger` satisfying both `PipelineTerminalHookLogger` and `CleanupLogger`. Three methods: `info(obj, msg?)`, `warn(obj, msg?)`, `error(obj, msg?)`. Body: `console[level](JSON.stringify({ ts: new Date().toISOString(), level, ...obj }), msg ?? '')`. If the extraction proves fragile (test fixtures reimport pipeline router etc.), inline a copy inside `daemon.ts` and defer the refactor.

**T5.** In `daemon.ts`, after env validation:
1. Resolve adapters: `db`, `realtime`, `isolation`, `executor` via `registry.get<...>(...)`.
2. Construct `DeployBridge` via `createDeployBridge({ db, registry, logger: consoleLogger, isolation, issueService: createIssueService(db) })`. Store in a local.
3. Construct `PipelineTerminalHook` via `createPipelineTerminalHook({ deployBridge, isolation, logger: consoleLogger })`.
4. Construct `EventOrchestrator` via `createEventOrchestrator(db, executor, realtime, isolation, terminalHook)` (default config — `maxConcurrentRuns: 5`, which is the hardcoded default; acceptable because the value pre-dates R-DAEMON and changing it is out of scope).
5. Construct `CleanupScheduler` via `createCleanupScheduler({ cleanupService, logger })` — wire the `cleanupService` per the pattern in whatever file already calls it. Grep for the existing factory use; if none, build it with `createCleanupService({ db, logger: consoleLogger, ... })` reading the current constructor shape.
6. Call `await orchestrator.recoverOnStartup()` **before** `.start()`. Log `daemon.recovery_complete {count: <n>}` after it returns. (The function currently returns void; count can be derived by a preliminary `select count(*) ... where status = 'running'` if needed for the log. Optional; skip if it complicates the code.)
7. Call `orchestrator.start()` → log `daemon.orchestrator_started`.
8. Call `cleanupScheduler.start()` → log `daemon.cleanup_scheduler_started` (scheduler itself logs when it actually runs).
9. Emit the final sentinel: `console.log('daemon.started orchestrator=running cleanup=<running|disabled> recovery_sweep=<enabled|disabled>')`. The `<running|disabled>` and `<enabled|disabled>` reflect actual state (scheduler no-ops silently when envs are missing; recovery-sweep is W4 — leave it as `disabled` here and flip in W4).

**T6.** Manual verification: `npm run daemon` with full env. Expect: `daemon.booting` → `daemon.recovery_complete` → `daemon.orchestrator_started` → `daemon.cleanup_scheduler_started` → `daemon.started orchestrator=running cleanup=... recovery_sweep=disabled`. From another terminal, insert a pipeline_run row manually (via `npm run db:studio` or a one-off script) at `status='pending'` — the daemon should pick it up via Realtime and attempt to launch the first stage. Won't succeed end-to-end (no executor setup, no seed issue hooked up properly for an arbitrary insert) — but the orchestrator should *react*, and we should see a `launched` event written to the DB. Acceptance: evidence the Realtime subscription is wired.

**Commit:** `R-DAEMON W2: orchestrator + cleanup + recovery wiring`.

### Wave 3 — Signal handlers + graceful drain

**T7.** Back in `daemon.ts`, implement `shutdown(reason: string)`:
1. Early-return if already shutting down (`shuttingDown` flag).
2. Log `daemon.shutdown_initiated {reason}`.
3. Call `orchestrator.stop()`. Log `daemon.orchestrator_stopped`.
4. Call `cleanupScheduler.stop()`. Log `daemon.cleanup_scheduler_stopped`.
5. Clear the recovery-sweep interval (added in W4 — noop here, see W4).
6. Drain loop: poll `db.select({ count: sql<number>\`count(*)\` }).from(stageRun).where(eq(stageRun.status, STAGE_RUN_STATUS.running))` every 500ms. Break when count is 0 or `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS * 1000` elapsed. Log `daemon.drain_completed {remaining}`.
7. `process.exit(0)`.

**T8.** Register `process.on('SIGTERM', () => shutdown('SIGTERM'))` and `process.on('SIGINT', () => shutdown('SIGINT'))`. Also register a second-SIGTERM handler via `let sigtermCount = 0` closure — on second signal, `process.exit(130)`.

**T9.** Export a `testShutdown` helper from `daemon.ts` (wrapped in `if (process.env.NODE_ENV === 'test')` or a named export gated on a module-level test flag) so integration tests can invoke shutdown without firing real signals. Structure: factor the wiring out of the top-level script into a `createDaemon()` factory returning `{ shutdown, orchestrator, cleanupScheduler }`. The top-level `daemon.ts` script body becomes `const d = createDaemon(); process.on(...)`. Tests import `createDaemon` directly.

**T10.** Integration test `src/__tests__/integration/daemon.test.ts` (NEW) — case "SIGTERM during idle":
1. Call `createDaemon()`.
2. Assert `orchestrator.running === true`.
3. Call `d.shutdown('TEST')`.
4. Assert `orchestrator.running === false`.
5. Assert the process did NOT exit (mock `process.exit` via a spy).

**Commit:** `R-DAEMON W3: graceful shutdown + testable factory`.

### Wave 4 — Periodic recovery sweep

**T11.** In `createDaemon()`, after `start()`, set up the recovery-sweep interval if `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` is set (value stored from W1 validation). Interval calls `orchestrator.recoverOnStartup()` and logs `daemon.recovery_sweep_ran`. Store the timer reference so `shutdown()` can clear it.

**T12.** Update the W2 sentinel log: `recovery_sweep=enabled` when the interval is active.

**T13.** Integration test case "recovery sweep wakes stale stage_run":
1. Seed a fake stage_run row with `status='running'` and `pid=1` (PID 1 is init — alive, so this is a *negative* test; pick an unused PID: 2147483647). Actually the condition is "PID not alive." Use `process.pid + 999999` which is virtually guaranteed dead.
2. Call `d.orchestrator.recoverOnStartup()` directly.
3. Assert the stage_run transitioned to `failed`.
4. Assert a retry was launched or the run finished, per `stage.maxRetries`.

**Commit:** `R-DAEMON W4: periodic recovery sweep`.

### Wave 5 — Trigger-path change

**T14.** In `src/server/routers/pipeline.ts` `runs.trigger` mutation, after the R-EPIC `ISSUE_IS_EPIC` guard and the `createRun` call:
- **Delete** the `updateRunStatus(run.id, 'running')` call. Run stays at `pending`.
- **Delete** the `createStageRun(run.id, input.stageId)` call. Daemon creates stage_runs via `launchStage`.
- **Delete** the `updateStageRunStatus(sr.id, 'launching')` call.
- **Delete** the `appendEvent(sr.id, 'launched', ...)` call.
- **Delete** the entire `executeManualRun(...)` block — the executor, isolation, issueService, deployBridge, terminalHook local construction, and the fire-and-forget `.catch()`.
- **Keep** the pipeline/stage/issue existence checks and the final `return run`.
- Net: the trigger handler becomes ~15 lines shorter.

**T15.** Delete imports that are now unused: `executeManualRun`, `createDeployBridge`, `createPipelineTerminalHook`, `StageExecutor`, `IsolationProvider`, `consoleLogger` — whichever get dead. Let `tsc --noEmit` identify.

**T16.** Manual verification: with `npm run dev` + `npm run daemon` both running, click "Run Stage" in the UI on a seed issue. Expect: the tRPC call returns fast (no subprocess wait), the daemon picks up the pending run within ~300ms, logs `launched` + `running` state, and the UI updates via Realtime. The existing Playwright journey `e2e/real-anthropic-stage-run.spec.ts` should still pass because the behavior is the same from the UI's perspective — just sourced from a different process. Run it to confirm: `npx playwright test e2e/real-anthropic-stage-run.spec.ts` with the daemon running. If it fails, debug before shipping T17.

**T17.** Integration test case "trigger path writes pending, daemon drives to completed": see W6 journey; this is the same scenario in a smaller test. Add `daemon.test.ts` case that:
1. Calls `createDaemon()`.
2. Inserts a pipeline_run at `pending` with a seeded mock-executor-friendly pipeline+issue.
3. Waits (with timeout) for the pipeline_run status to reach `completed` via polling.
4. Asserts stage_runs were created by the daemon (verified by checking the `trigger` column = `'automated'`).

**Commit:** `R-DAEMON W5: trigger path writes pending only; daemon owns execution`.

### Wave 6 — Journey test (live Anthropic + sandbox repo)

**T18.** Copy-adapt `e2e/real-anthropic-stage-run.spec.ts` into `e2e/r-daemon-autonomous-run.spec.ts`. Differences:
- Boot the daemon via `child_process.spawn('npm', ['run', 'daemon'], { env: {...process.env, FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS: '60', FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN: '5' }, stdio: ['ignore', 'pipe', 'pipe'] })`.
- Wait for the sentinel regex `/daemon\.started /` on stdout before proceeding.
- Run the existing journey (file a child issue, click Run Stage, wait for completion, assert a PR got opened).
- On teardown: send SIGTERM, assert exit within `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS + 5` seconds, kill if not.

**T19.** Run the journey end-to-end. All assertions green. Capture stdout tail in a comment if anything unexpected surfaces.

**Commit:** `R-DAEMON W6: live-validated autonomous-run journey`.

### Wave 7 — systemd unit + docs + roadmap

**T20.** Create `ops/systemd/fluxaos-daemon.service` per spec R4. Verify `systemd-analyze --user verify ops/systemd/fluxaos-daemon.service` locally.

**T21.** Add `ops/README.md` with the install / enable / logs / status runbook (four commands).

**T22.** Update `docs/superpowers/roadmap.md`:
- Move R-DAEMON row from the Alpha table's "Next" row to the Done table with links to the spec + plan + this PR.
- "What's Next" section: R-SETTINGS-ALPHA or R-MISSION-CONTROL (both unblocked). Pick R-SETTINGS-ALPHA as the narrower next phase; R-MISSION-CONTROL can follow.
- Dependency-ordering paragraph: note R-SMOKE now has daemon dependency satisfied.
- Current-engine-state paragraph: add a sentence — "The daemon runs as a systemd user unit, subscribes to pipeline_run via Realtime, and owns execution end-to-end. tRPC triggers are now publish-only."

**T23.** Update `CLAUDE.md`:
- Commands table: add `npm run daemon — Start the orchestrator daemon (foreground)`.
- R-RUNTIME env vars section: add the two new R-DAEMON env vars.

**T24.** Update `docs/invariants.md` with the new invariant: "The daemon is the sole path from `pipeline_run:pending` to `pipeline_run:running`. tRPC must not call the executor directly. Manually-triggered runs write `pending` and wait for the daemon to pick up."

**T25.** Final verification matrix:
- `npx tsc --noEmit` → clean.
- `npx vitest run` → all integration cases pass, including new `daemon.test.ts` (3+ cases).
- `npx playwright test e2e/r-daemon-autonomous-run.spec.ts` → PASS.
- `npm run build` → clean.
- Pre-commit size cap: new files under 500 lines. `daemon.ts` expected ~150 LoC; `daemon.test.ts` ~180 LoC; journey test ~200 LoC.
- Biome format on new files clean.
- `npm run verify` → 10/10 (unchanged from baseline).

**T26.** Open PR. Write PR body summarizing waves + verification matrix + decision log (Realtime vs BullMQ, systemd user unit). Squash-merge on green.

**T27.** After merge: delete local branch, prune remote. Write session handoff to `docs/superpowers/handoffs/2026-04-24-r-daemon-session-handoff.md`.

**Commit sequence:** W1, W2, W3, W4, W5, W6 each produce one commit. W7 produces a final "docs + roadmap + systemd unit" commit. Seven commits, merged as squash → one on main.

---

## Verification Matrix (filled in during execution — copy back to spec §11)

| Gate | Expected | Actual |
|---|---|---|
| `npx tsc --noEmit` | clean | _pending_ |
| `npx vitest run` | all green, new cases pass | _pending_ |
| `npx playwright test e2e/r-daemon-autonomous-run.spec.ts` | PASS | _pending_ |
| `npm run build` | clean | _pending_ |
| Pre-commit size cap | no files over cap | _pending_ |
| Biome format (new files only) | clean | _pending_ |
| `npm run verify` (seed-check) | 10/10 PASS | _pending_ |

---

## Goal-backward check

What does success look like, read backwards from the user's next action?

1. Operator runs `systemctl --user enable --now fluxaos-daemon`. Journal shows `daemon.started`. ✓ W7 ships the unit, W2+W4 ship the sentinel.
2. Operator files a child issue via UI. Nothing to click — no manual "Run Stage". (Actually alpha doesn't file autonomously from UI yet; "Run Stage" click remains the manual trigger. Autonomous filing is R-SMOKE territory.) Operator clicks "Run Stage" for the first time in this new world. ✓ W5 ships the trigger change; UI feels identical.
3. Within seconds, the UI shows the stage run advancing, the worktree being created, subprocess output streaming. ✓ W2 wires the orchestrator; existing R-RUNTIME + R-ARTIFACTS paths fire unchanged.
4. The run completes. The deploy bridge opens a PR. The worktree releases. ✓ Existing terminal hook; daemon invokes it the same way the trigger used to.
5. Operator restarts their machine. systemd brings the daemon back. On boot, the daemon finds any half-done stage_run rows, fails them, and either retries or fails the run. ✓ W2 ships `recoverOnStartup`; W4 ships the periodic sweep; W7 ships `Restart=always`.

Each step has a wave that delivers it. No wave fails to map to a success criterion.

---

## Risks / pitfalls to watch

- **T5 dependency construction order.** `IsolationProvider`, `DeployBridge`, `IssueService` each need the DB. Resolve DB once at the top of `createDaemon()`, pass it down. Don't re-resolve inside each factory.
- **T5 `CleanupService` factory signature.** Grep existing integration tests for the pattern before writing `daemon.ts`; the test fixtures likely already assemble a cleanup service the way we need.
- **T16 existing journey regression.** If `real-anthropic-stage-run.spec.ts` depended on the trigger's synchronous stage_run creation (e.g., asserted on the stage_run row immediately after clicking), the Realtime delay might flake it. Fix: the spec already uses `expect(...).toHaveText(...)` style polling via Playwright's web-first assertions, which naturally wait. Should be fine; if not, adjust timeouts.
- **T18 spawn of `npm run daemon` from a Playwright test.** On some CI layouts this doesn't inherit the right env. We're not running CI for these; local homelab execution is the target. Still, validate that `process.env` forwarding picks up `.env.local` — if not, source it in the spawn command or pass the envs explicitly.
- **Realtime sometimes delivers duplicate events.** If an INSERT + UPDATE fire for the same `pending` row in rapid succession, both handlers can race. The existing `handleNewRun` guard (`run.status !== PIPELINE_RUN_STATUS.pending` returns early) handles this — the first handler flips the status to `running`, the second sees `running` and no-ops. Verify by reading `handleNewRun` once more during implementation.
- **`recoverOnStartup` called twice in quick succession** (periodic sweep fires during the startup sweep): the function is idempotent because each iteration re-queries `stage_run where status = 'running'`. If the startup sweep has failed a stage_run to `failed`, the periodic sweep won't find it. Safe. But don't *launch* two retries — mitigation: both code paths go through `runService.completeStageRun` which is idempotent on the same state (or throws; handle errors).

---

## Out-of-scope reminders (spec §3 carryovers)

- No BullMQ path. No leader election. No /health HTTP endpoint. No new schema. No full logging refactor. No deploy bridge changes.
