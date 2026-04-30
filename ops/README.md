# fluxaOS — Operator runbook

Operational configuration lives here. Alpha scope supports local/dev daemon operation and a production Docker rehearsal that runs durable web and daemon services.

## Production Docker rehearsal

The production Docker rehearsal runs from `/mnt/stacks/docker/fluxaos/`, not from the development checkout.

The fluxaOS web and daemon containers intentionally run as root. This is an explicit exception to the usual homelab `user: "1026:100"` convention because the daemon writes git worktrees, artifacts, and stack-owned target clones on NFS-backed storage. Keep writable mounts scoped to `/mnt/stacks/docker/fluxaos/`.

Expected stack layout:

```text
/mnt/stacks/docker/fluxaos/
  docker-compose.yml
  fluxaos.env
  build.sh
  deployed-sha
  source/
  repos/
  worktrees/
  artifacts/
```

Create the stack directories, then clone the production source and target repos:

```bash
mkdir -p /mnt/stacks/docker/fluxaos/{source,repos,worktrees,artifacts}
git clone https://github.com/fluxaOS/fluxaos.git /mnt/stacks/docker/fluxaos/source
mkdir -p /mnt/stacks/docker/fluxaos/repos/fluxaOS
git clone https://github.com/fluxaOS/fluxaos.git /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos
```

The target clone should be the intended repository and clean on the expected base branch before rehearsal. In the template env, `FLUXAOS_TARGET_REPO_PATH=/repos/fluxaOS/fluxaos` maps inside the containers to the host path `/mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos`; the daemon writes deploy branches and worktrees against that target repo.

Configure the target clone for production Git writes before running `build.sh`:

```bash
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos config user.name "fluxaOS"
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos config user.email "fluxaos@users.noreply.github.com"
git -C /mnt/stacks/docker/fluxaos/repos/fluxaOS/fluxaos push --dry-run origin HEAD:refs/heads/fluxaos-preflight-check
```

The dry-run push must succeed from the host and from the production container preflight. Use an authenticated remote that works non-interactively for Git CLI push; `FLUXAOS_GITHUB_TOKEN` is still required for GitHub API operations, but Git itself also needs writable credentials through the target repo remote/config.

Bootstrap the stack files from the checked-in templates:

```bash
cp /mnt/stacks/docker/fluxaos/source/ops/docker/homelab/docker-compose.yml /mnt/stacks/docker/fluxaos/docker-compose.yml
cp /mnt/stacks/docker/fluxaos/source/ops/docker/homelab/fluxaos.env.example /mnt/stacks/docker/fluxaos/fluxaos.env
cp /mnt/stacks/docker/fluxaos/source/ops/docker/homelab/build.sh /mnt/stacks/docker/fluxaos/build.sh
chmod +x /mnt/stacks/docker/fluxaos/build.sh
```

Fill `/mnt/stacks/docker/fluxaos/fluxaos.env` with real Supabase, AI provider, GitHub, Redis, daemon, and cleanup values.

Deploy or update:

```bash
/mnt/stacks/docker/fluxaos/build.sh
```

The Compose daemon service runs `node .next/daemon/daemon.mjs` directly so SIGTERM reaches the production daemon entrypoint and the configured drain window can run.

Routine restarts do not run migrations:

```bash
cd /mnt/stacks/docker/fluxaos
docker compose up -d fluxaos-web fluxaos-daemon
```

Backup expectations for this profile:

- Supabase Cloud owns database/auth/realtime backups.
- Back up `/mnt/stacks/docker/fluxaos/fluxaos.env`.
- Back up `/mnt/stacks/docker/fluxaos/repos`.
- Back up `/mnt/stacks/docker/fluxaos/artifacts`.
- Back up `/mnt/stacks/docker/fluxaos/deployed-sha` and `/mnt/stacks/docker/fluxaos/rollback`.
- `/mnt/stacks/docker/fluxaos/worktrees` is runtime working state and may be cleaned by policy.

Restore expectations:

- The rollback marker only restores the image/version by retagging the previous image to the channel and recreating `fluxaos-web` and `fluxaos-daemon`, for example: `docker tag fluxaos:<previous-sha> fluxaos:internal-dev && docker compose up -d --force-recreate fluxaos-web fluxaos-daemon`.
- Compose `env_file` values become container environment, not Compose interpolation for the `image:` or `ports:` expressions. `FLUXAOS_IMAGE` and `FLUXAOS_WEB_PORT` must come from the shell environment, a Compose `.env`, `docker compose --env-file`, or the defaults.
- The rollback marker does not undo database migrations.
- Before running an update that includes migrations, confirm Supabase Cloud backup/PITR is available for the project.
- If a migration must be rolled back, restore through Supabase Cloud first, then restart the previous image from the rollback marker.

## Orchestrator daemon

For local/dev operation, the daemon (`npm run daemon`, source: `src/scripts/daemon.ts`) is a long-running Node process that subscribes to Supabase Realtime on the `pipeline_run` table, dispatches stage runs via the event-orchestrator, runs the cleanup scheduler, and performs periodic crash recovery. It is the sole path from `pipeline_run:pending` to `pipeline_run:running` — tRPC triggers are publish-only (see `docs/invariants.md`).

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
