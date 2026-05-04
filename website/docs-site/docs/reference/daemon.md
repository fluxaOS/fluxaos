---
sidebar_position: 6
title: The Daemon
---

# The Daemon

The orchestrator daemon is a long-running background process that executes pipeline runs. You do not start it by clicking "Run" in the UI — it runs continuously in the background.

## What it does

1. **Listens** for new `pipeline_run` rows via Supabase Realtime
2. **Executes** stage runs by spawning subprocesses (the AI CLI driver)
3. **Streams** output events back to the database as they arrive
4. **Evaluates** gates after each stage and routes to the next stage
5. **Transitions** issue states and statuses as stages complete
6. **Cleans up** stale worktrees and artifact directories
7. **Recovers** from crashes on startup (and periodically if configured)

## Starting the daemon

**Production (systemd):**
```bash
systemctl --user start fluxaos-daemon
systemctl --user status fluxaos-daemon
```

**Development:**
```bash
npm run daemon
```

The daemon reads all `FLUXAOS_*` environment variables at startup. `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` is required — the daemon refuses to start without it. See [Environment Variables](./env-vars).

## Checking if the daemon is running

If pipeline runs sit at **Pending** status and don't progress, the daemon is likely not running.

```bash
# Check systemd status
systemctl --user status fluxaos-daemon

# Or look for the process
ps aux | grep 'npm run daemon\|tsx.*daemon'
```

## Graceful shutdown

Send `SIGTERM` (systemd stop) or `Ctrl+C` (dev). The daemon:
1. Stops accepting new runs
2. Waits for running stages to finish (up to `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS`)
3. Force-kills any stages still running after the grace period
4. Exits

Set `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` to a value that gives in-flight stages enough time to complete cleanly.

## Crash recovery

On startup, the daemon scans for `stage_run` rows marked `running` whose process is no longer alive. It marks them as failed and routes the pipeline to the `onFail` stage.

If `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` is set, this scan also runs periodically. Without it, recovery only happens at startup.

## Live updates depend on the daemon

The UI updates in real time because the daemon writes to Supabase tables and Supabase Realtime pushes those changes to the browser. If the daemon is stopped mid-run:
- The run stays at its last known status in the UI
- Realtime will not deliver further updates for that run
- On daemon restart, crash recovery will detect the stale run and fail it forward
