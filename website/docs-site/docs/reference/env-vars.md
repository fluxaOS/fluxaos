---
sidebar_position: 1
title: Environment Variables
---

# Environment Variables

All `FLUXAOS_*` environment variables are documented here. Core services read them via `FluxaosConfig` (`src/config/env.ts`); adapters and the daemon script read some directly from `process.env`.

Set these in `.env` (committed, non-secret defaults) or `.env.local` (gitignored, secrets and local overrides).

## Daemon — Required

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` | integer | none (required) | Seconds to wait for in-flight stage runs to drain after SIGTERM. Daemon refuses to start without it. |

## Pipeline execution

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FLUXAOS_TARGET_REPO_PATH` | path | none | Absolute path to a local clone of the target repo. Stage runner refuses to acquire an isolation env without it. |
| `FLUXAOS_WORKSPACE_ROOT` | path | `<repo>/.fluxaos-worktrees/` | Where worktrees are created. Auto-added to target repo `.gitignore`. |
| `FLUXAOS_ARTIFACTS_ROOT` | path | `<repo>/.fluxaos-artifacts/` | Where per-run artifact directories live. Auto-added to target repo `.gitignore`. |
| `FLUXAOS_INIT_RESULT_DOC_SCRIPT` | path | none (required) | Path to the init-result-doc script invoked via `node`. Canonical value: `.next/daemon/init-result-doc.mjs`. Boot fails fast if unset (FLX-212). |
| `FLUXAOS_INGEST_RESULT_DOC_SCRIPT` | path | none (required) | Path to the ingest-result-doc script invoked via `node`. Canonical value: `.next/daemon/ingest-result-doc.mjs`. Boot fails fast if unset (FLX-212). |

## Cleanup scheduler

The cleanup scheduler only runs if all four vars are set. Missing any one disables it (logged warning; app still boots).

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN` | integer | none | How often (minutes) the cleanup sweep runs. |
| `FLUXAOS_CLEANUP_STALE_DAYS` | integer | none | Age in days before a worktree is considered stale and removed. |
| `FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS` | integer | none | Age in days before terminal session data is purged. |
| `FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS` | integer | none | Age in days before terminal pipeline run artifact directories are reaped. |

## Daemon recovery

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` | integer | none (optional) | If set, daemon runs crash recovery every N minutes. If unset, only the startup sweep runs. |

## Development / testing

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FLUXAOS_TEST_TARGET_REPO` | string | none | `owner/repo` that deploy-touching e2e journey tests open PRs against. Specs skip cleanly when unset. |
| `FLUXAOS_LAN_AUTH_BYPASS` | `1` | none | Set to `1` to let Playwright skip `/login` on LAN access (homelab use). |
