---
sidebar_position: 1
title: Environment Variables
---

# Environment Variables

This page documents the remaining `FLUXAOS_*` environment variables. Runtime deploy paths and cleanup policy are no longer env-backed: FLX-221..224 moved them into `project` / `config_entry` database rows.

Set env vars in `.env` (committed, non-secret defaults) or `.env.local` (gitignored secrets and local overrides). Core services read `FLUXAOS_INIT_RESULT_DOC_SCRIPT` and `FLUXAOS_INGEST_RESULT_DOC_SCRIPT` through `FluxaosConfig` (`src/config/env.ts`); the daemon, CLI, auth bypass, GitHub adapter, and tests read their own process env directly.

## Daemon — required

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` | positive integer | none (required) | Seconds to wait for in-flight stage runs to drain after SIGTERM. The daemon refuses to start without it. |

## Pipeline result documents

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FLUXAOS_INIT_RESULT_DOC_SCRIPT` | path | none (required) | Path to the init-result-doc script invoked via `node`. Canonical production value: `.next/daemon/init-result-doc.mjs`. Boot fails fast if unset (FLX-212). |
| `FLUXAOS_INGEST_RESULT_DOC_SCRIPT` | path | none (required) | Path to the ingest-result-doc script invoked via `node`. Canonical production value: `.next/daemon/ingest-result-doc.mjs`. Boot fails fast if unset (FLX-212). |

## Deploy credentials

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FLUXAOS_GITHUB_TOKEN` | token | none | GitHub PAT with `repo` scope. The deploy bridge fails fast when it needs to open a PR and this is unset. |

## Daemon recovery

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` | positive integer | none (optional) | If set, the daemon runs crash recovery every N minutes. If unset, only the startup sweep runs. |

## CLI

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FLUXAOS_API_URL` | URL | none | Full tRPC endpoint used by `npm run cli -- <command>`, e.g. `http://localhost:3004/api/trpc`. |
| `FLUXAOS_CLI_PROJECT_ID` | UUID | none | Project UUID targeted by the CLI (tenancy slugs were dropped in FLX-239 Stage 8 — UUIDs are the only addressing scheme). The seeded project is `00000000-0000-4000-8000-000000000001`. |

## Development / testing

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `FLUXAOS_TEST_TARGET_REPO` | string | none | `owner/repo` that deploy-touching e2e journey tests open PRs against. Specs skip cleanly when unset. |
| `FLUXAOS_TARGET_REPO_PATH` | path | none | Legacy/test-only local checkout path still consumed by older deploy-touching e2e specs. Not a runtime fallback; real stage acquisition reads `project.target_repo_path` from the database. |
| `FLUXAOS_LAN_AUTH_BYPASS` | `1` | none | Homelab-only auth bypass for local/LAN Playwright and CLI usage. Never set on an internet-reachable host. |

## DB-backed runtime config, not env

These names are the runtime source of truth after FLX-221..224:

| DB key / column | Where it lives | Purpose |
|-----------------|----------------|---------|
| `project.target_repo_path` | `project` table | Per-project absolute path to a local target-repo clone on `main`; `NULL` makes stage acquisition fail fast with `MissingProjectTargetRepoPathError`. |
| `runtime.workspace_root` | global `config_entry` row | Optional worktree root override. Seeded value `null` means use `<repo>/.fluxaos-worktrees/`. |
| `runtime.artifacts_root` | global `config_entry` row | Optional artifact root override. Seeded value `null` means use `<repo>/.fluxaos-artifacts/`. |
| `cleanup.sweep_interval_min` | global `config_entry` row | Cleanup scheduler cadence. |
| `cleanup.stale_days` | global `config_entry` row | Worktree stale threshold. |
| `cleanup.session_retention_days` | global `config_entry` row | Terminal session retention. |
| `cleanup.artifacts_retention_days` | global `config_entry` row | Artifact directory retention. |
| `cleanup.scheduler_enabled` | global `config_entry` row | Boolean boot gate; restart the daemon after changing it. |

The old env names `FLUXAOS_WORKSPACE_ROOT`, `FLUXAOS_ARTIFACTS_ROOT`, and `FLUXAOS_CLEANUP_*` are retired. If they appear in local templates or tests, they are compatibility scaffolding only; do not document or use them as operator configuration.
