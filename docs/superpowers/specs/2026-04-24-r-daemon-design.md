# R-DAEMON — Long-Running Orchestrator Process

**Phase:** R-DAEMON
**Status:** SPEC
**Created:** 2026-04-24
**Author:** Claude Opus 4.7 (1M)
**Depends on:** R-RUNTIME (Done), R-ARTIFACTS (Done), R-EPIC (Done)
**Prior art:** [archon-prior-art](../research/2026-04-22-archon-prior-art.md) — pattern #6 "Headless worker runtime" informed the daemon-as-separate-process shape.

---

## 1. Problem

fluxaOS pipelines execute inside the Next.js request that triggered them. `pipeline.runs.trigger` calls `executeManualRun(...)` fire-and-forget in the same Node process that served the tRPC mutation. Three problems:

1. **Server restart = lost work.** If the Next.js dev server restarts mid-run, the in-flight subprocess continues but nothing reads its result. The `pipeline_run` row sits at `running` forever, no stage advance, no terminal hook, no deploy bridge.
2. **No 24/7 operation.** The roadmap's alpha bet — "filing an issue triggers a full pipeline autonomously" — can't happen when the trigger path is a user clicking a button in a web UI.
3. **Event-orchestrator scaffolded but unused.** `src/core/orchestrator/event-orchestrator.ts` (455 LoC) already implements a Realtime-subscribing state machine with concurrency control, multi-stage chain advancement, retry handling, and crash recovery via `recoverOnStartup()`. It has zero call sites. The `BullMQAdapter` is also scaffolded and registered in bootstrap — also zero call sites. Both are dead code until R-DAEMON wires them up or disposes of them.

R-DAEMON wraps the orchestrator as a long-running process separate from the Next.js server, listening for `pipeline_run` inserts via Supabase Realtime, dispatching stage runs through the existing `event-orchestrator`, and running crash recovery on startup. Deployed as a systemd user unit.

## 2. Goals

- Standalone daemon process that boots independently of Next.js, subscribes to the Realtime `pipeline_run` INSERT/UPDATE streams, and drives runs to terminal status.
- Crash-recovery sweep on startup (`recoverOnStartup()`) plus the same sweep on a configurable cadence while running, so stage_runs whose PIDs are dead get failed + retried predictably.
- Cleanup scheduler (`src/core/cleanup/cleanup-scheduler.ts`) owned by the daemon's process lifetime — its own comment already says so.
- systemd user unit file + `Restart=always` + pre-start env validation + `ExecReload` for graceful config rereads.
- Graceful shutdown: SIGTERM → stop accepting new Realtime events → let in-flight stage runs finish (bounded by an env-gated wait) → exit.
- Next.js tRPC trigger stays as-is for now (writes the pipeline_run row; the daemon picks it up). The fire-and-forget `executeManualRun()` call **is removed** from the trigger path — the daemon now owns execution.
- `npm run daemon` starts the process in the foreground for dev; the systemd unit wraps it for production.
- Documented operator runbook: install unit → `systemctl --user enable --now fluxaos-daemon` → `journalctl --user -u fluxaos-daemon -f`.

## 3. Non-goals

- **BullMQ path.** The scaffolded adapter stays in the tree for this phase — it is not on the code path. The decision not to use it is documented in §10 (Deferred) with a follow-up DEF to remove or revisit post-alpha. Justification: Realtime is already the path the `event-orchestrator` was built around; it doesn't depend on Redis; and the alpha stack already runs Supabase. Adding Redis + BullMQ to the required-env surface is a step we don't need to take to satisfy the roadmap's R-DAEMON scope.
- **Multiple daemon instances / leader election.** Single-instance daemon. Concurrency is bounded inside the daemon (`maxConcurrentRuns`), not across daemons. If two daemons ran at once, two Realtime subscribers would each see every INSERT and race on `handleNewRun`. Post-alpha concern.
- **Root systemd unit / multi-user install.** `--user` unit only. Homelab context.
- **Redesigning the state machine.** The existing `event-orchestrator.ts` implementation is treated as a given. R-DAEMON wires it up and adds a periodic recovery sweep; it does not rewrite the applyVerdict / launchStage / handleStageFailed logic.
- **Queue depth / mission control UI.** R-MISSION-CONTROL scope (separate phase). R-DAEMON only ships the backend process.
- **Full logging infrastructure.** Uses `console.*` via a minimal logger shim. Structured-logging polish is R-POLISH scope.
- **Deploy bridge / worktree cleanup changes.** Already Done in R-RUNTIME + R-ARTIFACTS. Daemon wires the existing `PipelineTerminalHook` and `CleanupScheduler` — no new behavior in those subsystems.

## 4. Requirements

### R-DAEMON.R1 — Daemon entrypoint script

- Path: `src/scripts/daemon.ts`.
- Loads `dotenv/config`, calls `bootstrap()` to register adapters, resolves the required adapters out of the registry, instantiates the `event-orchestrator` and `cleanup-scheduler`, wires the pipeline-terminal-hook with the registered isolation + deploy bridge + logger, and calls `recoverOnStartup()` **before** enabling Realtime subscriptions. Ordering matters: recover first so we don't race against a new INSERT that happens to be pre-existing stale state.
- After `recoverOnStartup()` returns, calls `.start()` on both the orchestrator and the cleanup scheduler.
- Registers SIGTERM + SIGINT handlers that call the shutdown sequence (§R3).
- Registered as `npm run daemon` in `package.json`.
- The current `executeManualRun()` fire-and-forget call inside `pipeline.runs.trigger` is **removed**. The trigger continues to create the `pipeline_run` row (status `pending`) and the initial `stage_run` row with `reason: 'manually executed by user'`, but does not call the executor — the daemon's Realtime subscription fires `handleNewRun()` and drives from there.
- The `manual-run.ts` module itself stays (used by `orchestrator-demo.ts` and integration tests). Its tRPC call site goes away.

### R-DAEMON.R2 — Periodic crash-recovery sweep

- Already-implemented `recoverOnStartup()` does a one-shot pass at boot. Daemon additionally runs it on an interval.
- New env var: `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` (no default — follows no-invented-thresholds pattern). If unset, the periodic sweep is disabled and a warning logs on startup; startup-only sweep still runs. If set to a positive integer, the daemon sets up a `setInterval` that calls `recoverOnStartup()` on that cadence.
- Rationale for adding a periodic sweep beyond the Realtime subscription: if a stage_run's subprocess dies for a reason that doesn't produce an UPDATE on `pipeline_run` (e.g., OOM killed the executor before it wrote), the only way to notice is a PID-alive check. Realtime can't substitute for this.

### R-DAEMON.R3 — Graceful shutdown

- SIGTERM / SIGINT handler:
  1. Set a shutdown flag.
  2. Call `orchestrator.stop()` — unsubscribes the Realtime channels. No new runs picked up.
  3. Call `cleanupScheduler.stop()` — clears its interval.
  4. Clear the recovery-sweep interval if running.
  5. Wait up to `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` (no default — must be set) for in-flight stage_runs to finish. Counted by polling `select count(*) from stage_run where status = 'running'`.
  6. `process.exit(0)` whether or not the drain finished. Unfinished stage runs are caught by the next daemon boot's `recoverOnStartup()`.
- Second signal during drain forces immediate exit (`process.exit(130)`).
- The env-var gate (no default) means the operator chooses the drain window; we don't invent one.

### R-DAEMON.R4 — systemd user unit

- File: `ops/systemd/fluxaos-daemon.service`. Template unit:
  ```ini
  [Unit]
  Description=fluxaOS orchestrator daemon
  After=network-online.target
  Wants=network-online.target

  [Service]
  Type=simple
  WorkingDirectory=%h/dev/fluxaos
  EnvironmentFile=%h/dev/fluxaos/.env.local
  ExecStart=/usr/bin/env npm run daemon
  Restart=always
  RestartSec=5
  KillMode=mixed
  KillSignal=SIGTERM
  TimeoutStopSec=120
  StandardOutput=journal
  StandardError=journal

  [Install]
  WantedBy=default.target
  ```
- The path uses `%h/dev/fluxaos` for the homelab install. Post-alpha: template variables or a per-host override file.
- Install doc block added to `README.md` (or a new `ops/README.md`) covering: copy to `~/.config/systemd/user/`, `systemctl --user daemon-reload`, `systemctl --user enable --now fluxaos-daemon`, `journalctl --user -u fluxaos-daemon -f`, and `systemctl --user status fluxaos-daemon`.

### R-DAEMON.R5 — Logger shim

- Daemon needs a logger satisfying `PipelineTerminalHookLogger` and `CleanupLogger` interfaces. Today the tRPC path uses an inline `consoleLogger`. R-DAEMON lifts that into `src/core/logger/console.ts` so both call sites (tRPC manual-run removal notwithstanding, the test fixtures and `orchestrator-demo.ts` still need one) reference a single instance. Minimal: `{ info, warn, error }` each calling `console.*` with JSON-serialized context.
- Not on the critical path — if the refactor is messier than it looks, skip it and inline the shim inside `daemon.ts`. Document choice in the commit message.

### R-DAEMON.R6 — Trigger path: stop fire-and-forget

- `src/server/routers/pipeline.ts` `runs.trigger` mutation: keep all the pre-flight checks (R-EPIC `ISSUE_IS_EPIC` guard, pipeline/stage/issue existence, pipeline_run + stage_run creation, `launched` event). **Remove** the `executeManualRun(...)` block — the inline subprocess launch, the deploy-bridge instantiation, the terminal-hook construction. All of that is now daemon-owned.
- What the daemon sees: a new `pipeline_run` INSERT lands in Realtime. `handleNewRun(runId)` fires, detects `status = pending`, checks concurrency budget, launches the first stage via `launchStage(run, stages[0])`, and from there the existing event-orchestrator drives to terminal.
- **Important detail:** the trigger currently calls `updateRunStatus(run.id, 'running')` and then creates the first stage_run with status `launching` and appends a `launched` event. This is wrong for the daemon-driven path — the daemon expects to see `pending` in the Realtime payload (per `handleNewRun`'s guard). Fix: the trigger writes `pending` only. It does NOT create a `stage_run` row in advance. The daemon's `launchStage` creates the stage_run and emits its own bookkeeping. The "manually triggered" provenance is preserved by storing the trigger reason in a new event on the run (or by using the existing `trigger_type` column on `pipeline_run` if present — check schema before settling on the approach).
- **Provenance check (schema verification step during implementation):** if `pipeline_run` has no `trigger_type` column today and adding one is out of scope for R-DAEMON, fall back to: trigger creates the run at `pending`, appends a `pipeline_event` row of type `triggered` with `reason: 'manually executed by user'`. Daemon ignores this event — it's documentation-only. Schema columns are authoritative for logic; events are for audit.
- Net code change: ~20 lines deleted from `pipeline.ts`, nothing added except a possible `pipeline_event` insert for provenance.
- UI effects: no change visible to the operator beyond latency — instead of the stage launching "immediately" (same tick) after the trigger, it launches on the next Realtime round-trip (typically 100-300ms). The existing UI poll + Realtime subscription already handles this because it reads live DB state.

### R-DAEMON.R7 — Cleanup scheduler wiring

- Daemon calls `createCleanupScheduler(...).start()` after `recoverOnStartup()`. Scheduler has its own env-var gate (documented in CLAUDE.md "R-RUNTIME env vars" section) — if any of the four vars are unset, it logs a warning and no-ops. That behavior is unchanged.
- Scheduler's `stop()` is called during graceful shutdown (R3 step 3).

### R-DAEMON.R8 — Health / liveness

- Next.js keeps its `/api/health` route for web-layer health. Daemon does not expose an HTTP surface in alpha — `systemctl --user status` is the liveness indicator.
- Post-alpha: a `/health` HTTP endpoint on the daemon (separate port) returning orchestrator + cleanup scheduler `running` state. Filed as DEF (see §10).

### R-DAEMON.R9 — Verification: integration test

- New: `src/__tests__/integration/daemon.test.ts`. Cases:
  1. Daemon boot with all required env vars wires orchestrator + cleanup scheduler without throwing; `orchestrator.running` is `true` after `start()`.
  2. `recoverOnStartup()` finds a `running` stage_run with a dead PID and transitions it to `failed`, enqueuing a retry if retries remain. (Pre-populate the DB row, invoke the recovery function directly.)
  3. SIGTERM simulation: call the shutdown function and verify `orchestrator.stop()` + `cleanupScheduler.stop()` both invoked. (Mock the `process.exit` call via a test hook exported from `daemon.ts`.)
  4. Trigger-path INSERT → Realtime event → orchestrator handles the run end-to-end. Uses the mock executor pattern from `orchestrator-demo.ts`.

### R-DAEMON.R10 — Verification: journey test

- New: `e2e/r-daemon-autonomous-run.spec.ts`. Scenario:
  1. Boot the daemon as a child process (`spawn('npm', ['run', 'daemon'], { env: { ... } })`) with a scoped env including `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN`, `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS`, and the real Anthropic + GitHub tokens (same pattern as `real-anthropic-stage-run.spec.ts`).
  2. Wait for "daemon.started" log line on stdout (sentinel).
  3. Open browser, click "Run Stage" in the issue detail UI — tRPC now creates the run at `pending` without calling the executor.
  4. Poll the pipeline_run row via DB (using `db:runs` script or a direct query) until status = `completed`.
  5. Assert: the stage_run row was inserted by the daemon, not by the trigger; the live-output pane showed streaming subprocess stdout; the deploy bridge opened a PR; the worktree got released.
  6. Shut the daemon via SIGTERM; assert the process exits within `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS`.

### R-DAEMON.R11 — Docs + roadmap

- Add an "Operator setup: daemon" section to `README.md` (or promote the existing R-RUNTIME env var documentation into `ops/README.md` and reference from main README).
- `docs/superpowers/roadmap.md`: move R-DAEMON to Done after PR merges. "What's Next" updates to R-SETTINGS-ALPHA (or R-MISSION-CONTROL — both are unblocked).
- `docs/invariants.md`: add "The daemon is the sole path from `pipeline_run:pending` to `pipeline_run:running`. tRPC must not call the executor directly."

## 5. Non-obvious risks

- **Realtime on the server side.** Supabase Realtime in a Node process uses the `@supabase/supabase-js` client. The `realtime` adapter is already registered and used by the web UI (browser). Server-side usage is a different context: the Next.js SSR path sometimes resolves the adapter too. Confirmed there are no known server-side Realtime problems in the existing integration tests, but the daemon will be the first *persistent* server-side subscriber. If the connection dies (network blip), the `@supabase/supabase-js` client is supposed to reconnect automatically, but the reconnect behavior of the existing `SupabaseRealtimeProvider` adapter should be eyeballed during implementation. If it doesn't reconnect, the daemon goes deaf until restart. Mitigation: the periodic recovery sweep (R2) + systemd `Restart=always` + a simple "if no INSERT events seen for N minutes, log a warning" heartbeat (post-alpha). For alpha, rely on R2 + systemd.
- **Concurrency race with the trigger.** If the trigger creates `pipeline_run` at `pending` and the daemon picks it up in the same few milliseconds, the daemon's `handleNewRun` reads the row, sees `pending`, flips it to `running`, writes the first stage_run — before the trigger's return value reaches the browser. This is fine: the tRPC return is just the `pipeline_run` row; the UI subsequently subscribes to it via Realtime and sees the `running` transition. Covered by R10 journey test.
- **Event ordering on INSERT + immediate UPDATE.** The current `event-orchestrator.ts` subscribes to both INSERT and UPDATE, handling `pending` in both handlers. If the trigger somehow writes INSERT with `status = pending` and immediately UPDATEs to `running` in the same tick, both handlers could fire `handleNewRun`, and the second run would find the row at `running` and no-op (per the `run.status !== pending` early return). Benign — but worth confirming during implementation that we don't accidentally double-launch a stage.
- **`recoverOnStartup()` with no stale runs** does an empty query against `stage_run where status = 'running'`. Fine. The concern is if the daemon boots into a world where hundreds of zombie stage_runs exist — the PID-alive check loops through each and may take seconds. For alpha, acceptable; log progress so the operator sees it.
- **Removing `executeManualRun()` from tRPC is a behavior change.** Until the daemon runs, trigger clicks in the UI become no-ops (the pipeline_run sits at `pending` forever). This is an acceptable temporary state during the phase because we ship the daemon + the trigger change in the same PR. But during development across commits, the dev server will appear broken between commits — document in the plan that each wave's verification requires the daemon to be running.
- **`event-orchestrator.ts` may not compose cleanly with the current DeployBridge constructor.** During the spec pass, the trigger path constructs `createDeployBridge(...)` inline. The daemon must do the same at boot, not on every run. Verify the DeployBridge is safe to keep alive for the daemon's lifetime (no per-request state that needs a fresh instance).

## 6. Schema changes

None. The existing `pipeline_run` / `stage_run` / `event` / `issue_event` tables suffice. No new columns.

## 7. Configuration / env

New env vars added by R-DAEMON:

- `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` — interval in minutes for the periodic `recoverOnStartup()` sweep. Unset → periodic sweep disabled, warning logged, one-shot recovery on boot still runs.
- `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` — max seconds to wait for in-flight stage_runs during shutdown. **Must** be set — daemon refuses to start without it. This prevents invented defaults per the no-thresholds rule.

Existing R-RUNTIME env vars (`FLUXAOS_GITHUB_TOKEN`, `FLUXAOS_TARGET_REPO_PATH`, cleanup-scheduler envs) remain required when the daemon boots — their fail-fast behavior at bootstrap is preserved.

## 8. File plan

New:

- `src/scripts/daemon.ts` (~120 LoC) — boot, wire, signals, drain.
- `src/core/logger/console.ts` (~30 LoC) — shared console logger.  *(or inline into daemon.ts; decided during execution)*
- `ops/systemd/fluxaos-daemon.service` — unit file.
- `ops/README.md` — install runbook.  *(or inline block in main README)*
- `src/__tests__/integration/daemon.test.ts` — 4 cases.
- `e2e/r-daemon-autonomous-run.spec.ts` — journey.

Edited:

- `src/server/routers/pipeline.ts` — trigger.mutation minus executeManualRun call, minus deploy bridge construction, minus terminal hook.
- `package.json` — `"daemon": "tsx src/scripts/daemon.ts"` script.
- `docs/superpowers/roadmap.md` — R-DAEMON Done row.
- `docs/invariants.md` — new daemon invariant.
- `CLAUDE.md` — new env var docs.

Deleted / deprecated: none in this phase. BullMQ scaffold stays.

## 9. Wave decomposition (details to the plan)

Rough shape — full wave numbering goes in the plan:

1. **W1 — Daemon entrypoint + env validation.** Just `src/scripts/daemon.ts`, the `npm run daemon` script, and env validation. Daemon should boot and sit idle (no Realtime yet). Commit.
2. **W2 — Wire orchestrator + cleanup + recovery.** Add the orchestrator.start(), cleanup.start(), recoverOnStartup() calls. Still no trigger-path change. Commit.
3. **W3 — Signal handlers + drain.** SIGTERM / SIGINT → shutdown. Integration test for shutdown. Commit.
4. **W4 — Periodic recovery sweep.** Env-gated setInterval around recoverOnStartup. Integration test. Commit.
5. **W5 — Trigger-path change.** Remove executeManualRun call. Verify end-to-end via daemon running + UI click. Commit.
6. **W6 — Journey test (real daemon, real Anthropic, real sandbox repo).** Live validation. Commit.
7. **W7 — systemd unit + docs + roadmap update.** Ship docs. Commit.

Each wave gets its own commit; atomic; PR at the end.

## 10. Deferred

- **DEF-NEW-1: BullMQ scaffold disposition.** The adapter + port + bootstrap registration exist but have zero call sites after R-DAEMON. Two options post-alpha: (a) remove (dead code), (b) resurrect if R-MISSION-CONTROL or a distributed-daemon phase needs it. Alpha decision: leave in place. File as DEF with rationale.
- **DEF-NEW-2: Daemon /health HTTP endpoint.** Post-alpha.
- **DEF-NEW-3: Multiple-daemon / leader-election story.** Post-alpha.
- **DEF-NEW-4: Realtime reconnection hardening.** Dependent on field experience. Post-alpha.

## 11. Verification Matrix (to fill in during execution)

| Gate | Expected result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx vitest run` | all green including new `daemon.test.ts` |
| `npx playwright test e2e/r-daemon-autonomous-run.spec.ts` | PASS end-to-end |
| `npm run build` | clean |
| Biome lint on new files | clean (DEF-018 pre-existing drift on other files tolerated) |
| Pre-commit 500-line cap | no new files over cap; if any wave adds one, file DEF and add exemption |

## 12. Open implementation questions (resolved here)

Q: Should the daemon consume the BullMQ queue adapter and we only use Realtime for UI?
A: No. Two competing job-dispatch mechanisms is worse than one. Realtime is the single source of truth for pipeline_run state transitions.

Q: Should `executeManualRun` be deleted entirely?
A: No. `orchestrator-demo.ts` and potentially integration tests still use it. Its tRPC call site goes away; the function stays.

Q: Does the daemon need its own Supabase client separate from the one Next.js uses?
A: No. `bootstrap()` registers the adapters globally. The daemon process has its own registry instance (new Node process → new module state). Same factory, fresh Supabase client, no cross-contamination.

Q: Can the daemon write to the same DB that the Next.js server is reading via tRPC queries?
A: Yes. This is the whole point. Postgres + Realtime is the synchronization bus.

Q: What happens if the daemon dies mid-stage?
A: The stage_run row sits at `running`. On next daemon boot, `recoverOnStartup()` finds it, checks PID (dead), fails it, and either retries (if budget remains) or fails the run (with terminal hook firing for env release). This is the existing event-orchestrator logic — R-DAEMON reuses it.

Q: systemd user unit vs system unit?
A: User. Homelab install, one operator per machine. No chroot, no uid switch. User units live in `~/.config/systemd/user/` and `linger` must be enabled if the operator wants the daemon running when logged out (`loginctl enable-linger`). Mention in the runbook.
