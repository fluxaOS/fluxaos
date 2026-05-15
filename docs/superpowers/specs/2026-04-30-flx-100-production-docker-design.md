# FLX-100 Production Docker Design

> **Historical / superseded note (FLX-257):** This design predates the DB-backed runtime config migration. `FLUXAOS_TARGET_REPO_PATH`, `FLUXAOS_WORKSPACE_ROOT`, and `FLUXAOS_ARTIFACTS_ROOT` references below are now Docker preflight/history, not app runtime config.

**Status:** Design
**Linear:** [FLX-100](https://linear.app/rebos/issue/FLX-100)
**Date:** 2026-04-30

## Summary

fluxaOS production should be Docker-first. The homelab deployment is the production rehearsal for the future public GTM install path, not a special local-only setup. The first production profile runs the web UI and daemon together in Docker Compose, uses Supabase Cloud for database/auth/realtime, and uses the existing homelab `central_redis` service over the external `homelab` Docker network.

The implementation should separate development from production runtime:

- `/mnt/dev/fluxaos` remains the development checkout.
- `/mnt/stacks/docker/fluxaos/source` is the production source/build checkout until hosted images exist.
- `/mnt/stacks/docker/fluxaos/repos` holds target repository clones owned by the production runtime.
- `/mnt/stacks/docker/fluxaos/worktrees` holds per-run worktrees.
- `/mnt/stacks/docker/fluxaos/artifacts` holds per-run artifacts.

Before GTM, the same topology should transition from locally built images to GHCR-published images without changing the runtime layout.

## Goals

- Provide a production Docker topology for web UI + daemon.
- Use the existing homelab central Redis instead of adding a per-stack Redis container.
- Keep Supabase Cloud as the only production DB/Auth/Realtime target for this slice.
- Keep production runtime files under `/mnt/stacks/docker/fluxaos/`.
- Make deploy/update behavior explicit through a script rather than hidden container entrypoint work.
- Leave a clear path to future GHCR image publishing and a public install script.

## Non-Goals

- Self-hosting Supabase.
- Kubernetes, Helm, or multi-node orchestration.
- Replacing Supabase Cloud with central Postgres.
- Building the final public GTM installer in this slice.
- Supporting local code customizations in the production source checkout.

## Production Topology

The primary production stack lives at:

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

Compose runs two fluxaOS services from the same image:

- `fluxaos-web` — the Next standalone server.
- `fluxaos-daemon` — the orchestrator daemon.

Both services join the external `homelab` Docker network. They use:

```env
REDIS_URL=redis://:password@central_redis:6379
```

The password is the same one in `/mnt/dev/fluxaos/.env` — copy `REDIS_URL` from that file and replace `localhost` with `central_redis`. The stack does not declare `depends_on` for `central_redis`; the central database stack is operator-owned shared infrastructure. The future portable install profile may bundle Redis, but the homelab production profile should not.

## Container User

The usual homelab convention is `user: "1026:100"`. fluxaOS should be an explicit exception and run its app containers as root.

Rationale: the daemon creates git worktrees, writes artifacts, manages stack-owned target clones, and operates on NFS-backed directories. Because fluxaOS owns the image and all writable mounts are scoped under `/mnt/stacks/docker/fluxaos/`, running as root is simpler and less brittle than adding ownership repair logic to entrypoints.

This is a stack-specific exception, not a change to the homelab default.

## Runtime Mounts

Production must not use `/mnt/dev/...` as a runtime target. The daemon should edit a stack-owned clone:

```text
/mnt/stacks/docker/fluxaos/repos/<owner>/<repo>
```

Compose should mount runtime directories into stable container paths:

```text
/mnt/stacks/docker/fluxaos/repos:/repos
/mnt/stacks/docker/fluxaos/worktrees:/runtime/worktrees
/mnt/stacks/docker/fluxaos/artifacts:/runtime/artifacts
```

The daemon container also mounts the host SSH credentials read-only so it can push to GitHub without storing credentials in the image or env:

```text
/home/jpierce/.ssh:/root/.ssh:ro
```

This uses the same SSH key that works for the development checkout. The web container does not need this mount.

The production env then points at container paths:

```env
FLUXAOS_TARGET_REPO_PATH=/repos/fluxaOS/fluxaos
FLUXAOS_WORKSPACE_ROOT=/runtime/worktrees
FLUXAOS_ARTIFACTS_ROOT=/runtime/artifacts
```

This keeps production output out of the app image and out of the development checkout.

## Configuration

Production config lives in:

```text
/mnt/stacks/docker/fluxaos/fluxaos.env
```

It is initially seeded from the repo `.env` and `.env.local`, but production containers should not mount those repo files directly. Both `fluxaos-web` and `fluxaos-daemon` read `fluxaos.env`.

Required production config includes:

```env
DATABASE_URL=...
DIRECT_URL=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ANTHROPIC_API_KEY=...
FLUXAOS_GITHUB_TOKEN=...
REDIS_URL=redis://:password@central_redis:6379
FLUXAOS_TARGET_REPO_PATH=/repos/fluxaOS/fluxaos
FLUXAOS_WORKSPACE_ROOT=/runtime/worktrees
FLUXAOS_ARTIFACTS_ROOT=/runtime/artifacts
FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS=...
FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN=...
FLUXAOS_CLEANUP_STALE_DAYS=...
FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS=...
FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS=...
```

Optional production config:

```env
FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN=...
```

## Image Channels

Docker is the production and GTM distribution model. `npm install` remains the local development path.

During the homelab source-build phase, `build.sh` builds from `/mnt/stacks/docker/fluxaos/source` and tags images as:

```text
fluxaos:<git-sha>
fluxaos:internal-dev
```

Before GTM, CI should publish equivalent GHCR tags:

```text
ghcr.io/fluxaos/fluxaos:<git-sha>
ghcr.io/fluxaos/fluxaos:internal-dev
ghcr.io/fluxaos/fluxaos:edge
ghcr.io/fluxaos/fluxaos:vX.Y.Z
```

`internal-dev` is the homelab dogfood channel. `edge` is the latest successful mainline pre-release channel. Version tags are for stable public releases.

The production compose file should be shaped so it can switch from local `fluxaos:internal-dev` to `ghcr.io/fluxaos/fluxaos:<tag>` without changing mounts, env, or service boundaries.

## Update Flow

The homelab update flow should borrow the useful shape from NanoClaw's update playbook: clean preflight, preview, rollback marker, validation, and restart only after checks pass. fluxaOS does not need NanoClaw's cherry-pick/rebase customization flow; production deploys should use `main` or an explicit SHA.

`build.sh` should:

1. Enter `/mnt/stacks/docker/fluxaos/source`.
2. Verify the production source checkout has a clean working tree.
3. Fetch `origin`.
4. Show commits between `deployed-sha` and the selected target SHA.
5. Checkout the selected target SHA, usually `origin/main`.
6. Build the image with tags `fluxaos:<git-sha>` and `fluxaos:internal-dev`.
7. Run Drizzle migrations as a one-shot container.
8. Restart `fluxaos-web` and `fluxaos-daemon`.
9. Verify web health, daemon readiness, and container status.
10. Write the deployed SHA to `/mnt/stacks/docker/fluxaos/deployed-sha`.

Migrations must not run implicitly on every container boot. They run during the explicit update flow.

The future GHCR-backed update flow should keep the same shape but replace local build with `docker compose pull`.

## Migrations

Drizzle remains the migration system.

- Development creates migrations with `npm run db:generate` after schema edits.
- Production applies checked-in migrations with `npm run db:migrate`.
- The update script runs migrations once before restarting app processes.

This avoids entrypoint magic and avoids mutating schema on routine container restarts.

## Health, Logs, And Shutdown

Initial operations use Docker-native logs:

```bash
docker compose logs -f fluxaos-web
docker compose logs -f fluxaos-daemon
```

Health checks:

- Web: `GET /api/health`.
- Daemon: readiness line `daemon.started orchestrator=running ...` in logs.
- Redis: existing `central_redis` container health/status.
- Target repo: update/deploy checks verify the configured path exists and is a git repo.

Daemon shutdown uses the existing `SIGTERM` drain behavior controlled by `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS`. Compose must give the daemon enough stop grace period to honor that value. The implementation should align Compose `stop_grace_period` with the env value used by the daemon.

## Backup And Restore

Backups for this slice:

- Supabase Cloud backups for database/auth/realtime state.
- `/mnt/stacks/docker/fluxaos/fluxaos.env`.
- `/mnt/stacks/docker/fluxaos/repos`.
- `/mnt/stacks/docker/fluxaos/artifacts`.
- `/mnt/stacks/docker/fluxaos/deployed-sha`.

`worktrees` are runtime working state. They are useful for debugging and interrupted-run recovery, but cleanup policy may remove them. They are not the canonical source of completed changes; completed deploy work is committed and pushed to the target repo.

## Git Auth

The daemon creates git worktrees and pushes deploy branches to GitHub. The homelab production auth mechanism is SSH via the host operator key — the same key used for the development checkout.

The `fluxaos-daemon` Compose service mounts `/home/jpierce/.ssh:/root/.ssh:ro`. Both the source and target repo clones under `/mnt/stacks/docker/fluxaos/` must use `git@github.com:...` SSH remotes (not HTTPS). The bootstrap runbook instructs the operator to clone via SSH and to correct any existing clone that has an HTTPS remote.

The `build.sh` dry-run push preflight (`git push --dry-run origin HEAD:refs/heads/fluxaos-preflight-check`) verifies write access before any build or migration runs. It executes on the host, so host SSH auth applies. The daemon's pushes inside the container use the mounted SSH credentials.

For GTM, the portable install profile will replace this with a deploy key or GitHub App credential. The homelab SSH mount is explicitly a single-operator shortcut that does not belong in the future public installer.

## Playwright Coverage for Root Redirect

`src/app/page.tsx` exports `dynamic = 'force-dynamic'` so the DB-backed root redirect runs at request time rather than being statically rendered during the Docker build. This is required for the production image to work correctly.

A dedicated `e2e/root-redirect.spec.ts` covers this change: navigate to `/`, assert the URL resolves to `/{org}/{user}/{project}`. No daemon or Anthropic credentials required — only a running dev server and seeded database. This spec satisfies the pre-push Gate 3 requirement for any future `page.tsx` changes.

## Completion Bar

The instance is complete when:

1. `build.sh` exits 0 — image built from current branch SHA, migrations applied, both containers running.
2. `http://192.168.54.101:3003` loads the fluxaOS UI in a browser and functions normally.
3. The daemon container processes pipeline runs.

The dev server (`npm run dev`) is not used for this instance. The production image is the artifact.

## Rejected Alternatives

### Host daemon + Docker web

This preserves current systemd behavior, but it leaves two process managers owning one app. It also keeps the drift between Docker, systemd, env files, mounts, and logs. Rejected for production because the goal is a real Docker runtime story.

### Portable all-in-one compose first

Bundling Redis in the first production compose file would be easier for future external users, but it does not match the actual homelab deployment target. The portable profile should come later as part of the GTM install work.

### npm install as production path

Host-native npm installs are more sensitive to Node version, npm version, global tools, service manager setup, and host filesystem permissions. Docker gives fluxaOS a publishable artifact and a cleaner public install story. npm remains the development path.

## First Implementation Slice

The first implementation creates the homelab production instance — a running `http://192.168.54.101:3003` deployment that matches what would ship today, updated going forward via `build.sh`:

- Production compose with `fluxaos-web` and `fluxaos-daemon` services, SSH mount on the daemon, no dev-server dependency.
- `build.sh` for the source-build update flow with Redis auth preflight and dry-run push preflight.
- Bootstrap runbook using SSH clones and `REDIS_URL` sourced from the dev `.env`.
- `e2e/root-redirect.spec.ts` covering the `force-dynamic` root redirect so Gate 3 passes without bypass.
- Verified by running `build.sh` to completion and confirming the UI loads at port 3003.

The public install script and GHCR publishing are follow-up work, but this design intentionally leaves compatible seams for both.
