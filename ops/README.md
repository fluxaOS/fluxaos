# fluxaOS — Operator runbook

Operational configuration lives here. Alpha scope only — the daemon is the one durable process an operator needs to stand up.

## Orchestrator daemon

The daemon (`npm run daemon`, source: `src/scripts/daemon.ts`) is a long-running Node process that subscribes to Supabase Realtime on the `pipeline_run` table, dispatches stage runs via the event-orchestrator, runs the cleanup scheduler, and performs periodic crash recovery. It is the sole path from `pipeline_run:pending` to `pipeline_run:running` — tRPC triggers are publish-only (see `docs/invariants.md`).

### Required environment

Set these in `.env.local` before starting the daemon:

- `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` — positive integer; seconds to wait for in-flight stage runs to drain after SIGTERM. No default. Operator chooses.
- `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` — positive integer, optional. If set, daemon runs `orchestrator.recoverOnStartup()` on that cadence to reap stale `stage_run` rows whose PIDs are dead. If unset, only the startup sweep runs.

Plus the R-RUNTIME and cleanup-scheduler envs already documented in `CLAUDE.md`.

### Install as a systemd user unit

```bash
# 1. Copy the unit file into your user systemd directory.
mkdir -p ~/.config/systemd/user
cp ops/systemd/fluxaos-daemon.service ~/.config/systemd/user/

# 2. (First install only) enable lingering so the daemon runs when you're not logged in.
loginctl enable-linger "$USER"

# 3. Reload and start.
systemctl --user daemon-reload
systemctl --user enable --now fluxaos-daemon

# 4. Watch the logs.
journalctl --user -u fluxaos-daemon -f

# 5. Status check.
systemctl --user status fluxaos-daemon
```

The unit file uses `%h/dev/fluxaos` for the repo path. Adjust if you checked out elsewhere. `Restart=always` means the daemon comes back automatically on crash; `KillMode=mixed + TimeoutStopSec=120` gives SIGTERM-then-SIGKILL semantics with a 2-minute drain window (align with `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS`).

### Sentinel log line

On ready the daemon prints one plain-text line:

```
daemon.started orchestrator=running cleanup=<running|disabled> recovery_sweep=<enabled|disabled>
```

`cleanup=disabled` means the four `FLUXAOS_CLEANUP_*` envs are not all set; the cleanup scheduler is a no-op until they are. `recovery_sweep=disabled` means `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` is unset; startup-only sweep still runs.

### Foreground dev loop

Run the daemon interactively via `npm run daemon` (or equivalently `./node_modules/.bin/tsx src/scripts/daemon.ts`). Ctrl-C (SIGINT) triggers the graceful-drain path; SIGTERM has the same behaviour. A second signal during drain forces `process.exit(130)`.

Note: `npm run` under npm 10 swallows SIGTERM in some setups. If you need clean shutdown in a shell-test harness, invoke `./node_modules/.bin/tsx` directly; systemd sidesteps the wrapper via `KillMode=mixed`.
