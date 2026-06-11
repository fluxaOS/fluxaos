# Config Classification: Operational Config vs Bootstrap Secrets

**Date:** 2026-05-11
**Issue:** [FLX-220](https://linear.app/rebos/issue/FLX-220/settings-architecture-classify-operational-config-vs-bootstrap-secrets)
**Parent:** FLX-209 (Settings & config integrity)
**Status:** Spec only — no code changes in this slice
**Related:** FLX-89 (`config_entry` CRUD), FLX-222 (workspace root migration), FLX-223 (artifacts root migration), FLX-224 (cleanup vars migration)

---

## Problem

Today, many env vars are *operational config* — user-configurable per project or per org (target repo path, cleanup retention, workspace root) — but live in env files, not the DB. This violates the GTM principle "all settings live in the DB and are user-configurable."

Other env vars are genuine *bootstrap secrets* (DB credentials, API tokens, host-level wiring) and must stay in env.

No documented classification exists; the line is ad-hoc. This spec draws the line.

## Method

Audited via:

- `grep -rhoE 'FLUXAOS_[A-Z_]+' /mnt/dev/fluxaos/ --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.md' --include='*.example' --include='.env*' | sort -u`
- Canonical reader: `/mnt/dev/fluxaos/src/config/env.ts`
- `.env.example` (committed)
- `CLAUDE.md` § "R-RUNTIME env vars"
- Schema: `/mnt/dev/fluxaos/src/core/db/schema.ts` (notably `project`, `config_entry`)

Each var is traced to a call site to classify accurately. Vars that only appear inside test files (`__tests__/`) are listed under **Test-only**.

## Classification rubric

A var is a **Bootstrap secret** if any of the following hold:

1. It is a credential or token (anything that grants access to an external system).
2. It is required to read from the DB itself (chicken-and-egg — cannot live in the DB).
3. It identifies the deployment host or the env-file location (cannot move into a DB row because the DB row would have to live somewhere the reader knows about).
4. It is a build-time / boot-time switch read before any tRPC router or daemon service is constructed.

A var is **Operational config** if all of the following hold:

1. It is a tunable threshold, path, or feature flag that an admin would reasonably change at runtime.
2. The reader runs after `loadFluxaosConfig()` returns and after the DB connection is live.
3. Its value is org-wide or global (not per-project) — write to `config_entry` (scope `'global'` or `'org'`).

A var is **Per-project config** if its value differs per project (e.g., target repo path, default branch) — add a column on `project`.

A var is **Test-only** if it only appears under `src/__tests__/`, `e2e/`, or `tests/verify/`. These are never migrated to the DB and never appear in production env files; they remain process-env-only test fixtures.

## Master classification table — `FLUXAOS_*`

> **Amendment (2026-06-10, FLX-271 / PR #402):** `FLUXAOS_CLI_ORG_SLUG`, `FLUXAOS_CLI_USER_SLUG`, and `FLUXAOS_CLI_PROJECT_SLUG` are retired — slug-based addressing was removed by the FLX-239 tenancy epic, and the CLI now targets a project by UUID via `FLUXAOS_CLI_PROJECT_ID` (see `src/cli/config.ts`). The three slug rows below are superseded and kept for historical record only.

| Env Var | Classification | DB Target | Rationale |
|---|---|---|---|
| `FLUXAOS_LAN_AUTH_BYPASS` | **Bootstrap secret** | (stays env) | Auth-skip flag read by `src/lib/supabase/middleware.ts` and `src/server/trpc.ts` *before* a session exists. Reading from the DB would require auth, which is exactly what this flag bypasses. Host-level toggle. |
| `FLUXAOS_LAN_AUTH_BYPASS_CIDR` | **Bootstrap secret** | (stays env) | Companion to the bypass flag — same constraints. |
| `FLUXAOS_GITHUB_TOKEN` | **Bootstrap secret** | (stays env) | PAT credential. Read by `src/adapters/github/auth.ts`. Secrets do not belong in the DB without an external secret manager. |
| `FLUXAOS_ENV_PATH` | **Bootstrap secret** | (stays env) | Tells the daemon which `.env.local` to load. Reading the value from the DB requires the DB connection, which requires the env file — circular. |
| `FLUXAOS_API_URL` | **Bootstrap secret** | (stays env) | CLI client-side: tells `fluxaos` CLI which tRPC endpoint to call. Lives on the operator's workstation, not the server. The DB-backed setting would have to be reached *through* this URL. |
| `FLUXAOS_CLI_ORG_SLUG` | **Superseded (2026-06-10, FLX-271)** — was Bootstrap secret | (retired) | CLI client default context. Replaced by `FLUXAOS_CLI_PROJECT_ID` (UUID) — see amendment above. |
| `FLUXAOS_CLI_USER_SLUG` | **Superseded (2026-06-10, FLX-271)** — was Bootstrap secret | (retired) | Replaced by `FLUXAOS_CLI_PROJECT_ID` — see amendment above. |
| `FLUXAOS_CLI_PROJECT_SLUG` | **Superseded (2026-06-10, FLX-271)** — was Bootstrap secret | (retired) | Replaced by `FLUXAOS_CLI_PROJECT_ID` — see amendment above. |
| `FLUXAOS_INIT_RESULT_DOC_SCRIPT` | **Bootstrap secret** | (stays env) | Override path to a bundled `.mjs` script. Build-output location; default is `.next/daemon/init-result-doc.mjs`. Host filesystem layout, not user config. |
| `FLUXAOS_INGEST_RESULT_DOC_SCRIPT` | **Bootstrap secret** | (stays env) | Same as above — bundled `.mjs` script path. Host filesystem layout. |
| `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` | **Operational config** | `config_entry` key `daemon.shutdown_grace_seconds` (scope `global`) | Operator tunable. Read at daemon boot in `src/scripts/daemon.ts`; can be moved behind a `daemon.config` service that reads `config_entry` once at startup. Falls under the "operator owns the value, no default" contract. |
| `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` | **Operational config** | `config_entry` key `daemon.recovery_sweep_interval_min` (scope `global`) | Optional cadence for `recoverOnStartup` sweep. Same boot path as above. |
| `FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN` | **Operational config** | `config_entry` key `cleanup.sweep_interval_min` (scope `global`) | Cleanup scheduler tunable. Read in `loadFluxaosConfig()`; consumers read from injected config object. FLX-224. |
| `FLUXAOS_CLEANUP_STALE_DAYS` | **Operational config** | `config_entry` key `cleanup.stale_days` (scope `global`) | Worktree-age threshold. FLX-224. |
| `FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS` | **Operational config** | `config_entry` key `cleanup.session_retention_days` (scope `global`) | Session-reap threshold. FLX-224. |
| `FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS` | **Operational config** | `config_entry` key `cleanup.artifacts_retention_days` (scope `global`) | Artifacts-reap threshold. FLX-224. |
| `FLUXAOS_RUN_CLEANUP_SCHEDULER` | **Operational config** | `config_entry` key `cleanup.scheduler_enabled` (scope `global`) | Feature flag for whether the scheduler runs at all. Same module as the four thresholds above; migrate together with FLX-224. |
| `FLUXAOS_WORKSPACE_ROOT` | **Operational config** | `config_entry` key `runtime.workspace_root` (scope `global`) | Absolute path override for worktree storage. Read by `src/adapters/git/path-resolver.ts` via `loadFluxaosConfig()`. Host-shared root (all projects use it), not per-project. FLX-222. |
| `FLUXAOS_ARTIFACTS_ROOT` | **Operational config** | `config_entry` key `runtime.artifacts_root` (scope `global`) | Absolute path override for per-run artifact dirs. Read by `src/adapters/git/artifacts-path.ts`. Host-shared root. FLX-223. |
| `FLUXAOS_TARGET_REPO_PATH` | **Per-project config** | `project.target_repo_path` (new column, `text`, nullable) | Absolute path to the local clone of *that* project's target repo. Today single-tenant alpha hard-codes one value globally; multi-project requires per-project. Already partially surfaced via `src/server/routers/system.ts` (`ALLOWED_ENV_VARS`) and `src/app/[org]/[user]/[project]/settings/projects/page.tsx`. |
| `FLUXAOS_MODEL` | **Test-only / mock-only** | (stays env) | Only producer in `src/` is `scripts/orchestrator-demo.ts` (mock executor). Not consumed by production code; do not migrate. Document and leave in place. |
| `FLUXAOS_TEST_TARGET_REPO` | **Test-only** | (stays env) | E2E fixture — names the disposable repo Playwright deploy-touching journeys target. Never appears in production. |
| `FLUXAOS_TEST_LOCAL_ONLY` | **Test-only** | (stays env) | Daemon `.env.local` precedence fixture (`src/__tests__/integration/daemon.test.ts`). |
| `FLUXAOS_TEST_SHARED` | **Test-only** | (stays env) | Daemon `.env.local` precedence fixture (same test). |
| `FLUXAOS_SKIP_PREPUSH_GATE` | **Bootstrap secret (deprecated)** | (stays env, being removed) | Pre-push gate bypass. Per [FLX-191 memory], this is being removed entirely — no migration required; track removal under the original Linear issue. |
| `FLUXAOS_DAEMON_ENABLED` | **Bootstrap secret** | (stays env) | Operator-level toggle for whether the daemon process starts at all. Lives at the systemd-unit / `flux server` shim layer (`./flux server …`), not application code. Process-supervisor concern. |
| `FLUXAOS_WEB_PORT` | **Bootstrap secret** | (stays env) | HTTP listener port — host networking, read before tRPC stands up. |
| `FLUXAOS_IMAGE` | **Bootstrap secret** | (stays env) | Container image identifier — Docker/UAT wiring, read by deploy scripts. |
| `FLUXAOS_SYSTEMD_DIR` | **Bootstrap secret** | (stays env) | Filesystem location of systemd units — host wiring, used by `./flux` shim. |
| `FLUXAOS_BUNDLED_PIPELINES_DIR` | **Bootstrap secret** | (stays env) | Filesystem path to bundled pipeline templates — build-output layout, not user config. |
| `FLUXAOS_STAGE_EXECUTOR` | **Bootstrap secret** | (stays env) | Executor strategy switch read at bootstrap (`real` vs `subprocess` vs `mock`). Affects which adapter is registered before any DB reads. |
| `FLUXAOS_PROVIDER` | **Bootstrap secret** | (stays env) | Adapter-registry selector — chooses which provider implementation is wired at boot. |
| `FLUXAOS_AI_PROVIDERS` | **Bootstrap secret** | (stays env) | Adapter-registry list — same boot-time wiring constraint. |
| `FLUXAOS_AUTH_PROVIDER` | **Bootstrap secret** | (stays env) | Auth adapter selector — must be known before auth runs (i.e., before DB reads gated by auth can happen). |
| `FLUXAOS_GIT_PROVIDER` | **Bootstrap secret** | (stays env) | Git adapter selector — boot-time adapter wiring. |
| `FLUXAOS_QUEUE_PROVIDER` | **Bootstrap secret** | (stays env) | Queue adapter selector — boot-time adapter wiring (BullMQ vs mock). |
| `FLUXAOS_REALTIME_PROVIDER` | **Bootstrap secret** | (stays env) | Realtime adapter selector — boot-time adapter wiring. |
| `FLUXAOS_API_KEY` | **Bootstrap secret** | (stays env) | Credential used by external integrations (docs/scripts) — secrets do not move to DB. |
| `FLUXAOS_PROMPT` | **Bootstrap secret** | (stays env) | Debug/CLI input variable — operator-side scratch, not stored config. |
| `FLUXAOS_ENV_PATH__` / `FLUXAOS_REPO_PATH__` / `FLUXAOS_CLI_` / `FLUXAOS_CLEANUP_` | **Prefix artefacts** | n/a | These appear in the raw grep output as fragment captures from concatenated identifiers or doc text. Not standalone env vars; ignore. |

> **Note on FLX-89 prior art:** `config_entry` already supports a `(scope, project_id, key) -> jsonb value` schema with optimistic-concurrency `version`, `previousValue`, and `changedBy` audit fields. Every key listed above uses `scope = 'global'` and `project_id = NULL` unless otherwise stated. The Settings → System tab (FLX-89) is the editor surface.

## Non-FLUXAOS env vars (all bootstrap secrets, none move to DB)

These are encountered in `src/` and `.env.example`. Per the parent issue acceptance, they are all bootstrap secrets — listed here for completeness.

| Env Var | Reason |
|---|---|
| `DATABASE_URL` | Postgres connection string (pgbouncer pooler). Required to read *anything* from the DB — chicken-and-egg. |
| `DIRECT_URL` | Direct Postgres connection used for migrations. Same chicken-and-egg. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL — must be inlined into the client bundle at build time. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase anon/publishable key — client bundle, build-time. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role secret — credentials never move to DB. |
| `NEXT_PUBLIC_APP_URL` | SSR base URL — required at server boot before tRPC can self-call. |
| `NEXT_PUBLIC_BUILD_TIME` | Build metadata stamped at compile time. Cannot live in DB. |
| `NEXT_PUBLIC_GIT_SHA` | Build metadata stamped at compile time. Cannot live in DB. |
| `ANTHROPIC_API_KEY` | Vendor API credential. |
| `REDIS_URL` | BullMQ broker connection — required by the queue adapter before any DB-mediated config is reachable for queue consumers. |

## Migration order (minimize boot breakage)

The migration **is not in this slice**. This is the sequenced plan so FLX-222/223/224 (and any future operational-config migrations) can land safely. The principle is **add-DB-source-of-truth before removing-env-source-of-truth**, so the system always has at least one valid value source during each step.

For each operational/per-project var, repeat this six-phase order:

1. **Spec (this doc).** Classification documented.
2. **Schema additions.** Add columns / `config_entry` rows. For `config_entry`, no schema change is required (table already exists from FLX-89). For per-project columns (`project.target_repo_path`), generate + apply a Drizzle migration.
3. **Backfill / seed.** Default values populated by `npm run db:seed` (and a one-shot data migration for existing rows). At this point both env and DB hold the value; env wins.
4. **Reader migration.** Update `loadFluxaosConfig()` (and any direct `process.env.*` reader for that key) to prefer the DB value, fall back to env, and log a deprecation warning when the env value is what was used.
5. **Operator cutover.** Document removal of the env var from `.env.local`; run for ≥ 1 deploy cycle with DB-only values to confirm no regressions.
6. **Env removal.** Delete the env-reading code path; remove the var from `.env.example`, `CLAUDE.md` § "R-RUNTIME env vars", and `loadFluxaosConfig()`. The DB is now sole source of truth.

### Suggested ordering of the operational migrations

| Order | Issue | Vars | Reason for order |
|---|---|---|---|
| 1 | FLX-222 | `FLUXAOS_WORKSPACE_ROOT` | Isolated reader (one adapter, well-tested). Low blast radius — exercises the migration pattern end-to-end. |
| 2 | FLX-223 | `FLUXAOS_ARTIFACTS_ROOT` | Same shape as FLX-222 (one adapter, absolute-path validation). Lands the second instance of the pattern. |
| 3 | FLX-224 | `FLUXAOS_CLEANUP_*` (4 vars) + `FLUXAOS_RUN_CLEANUP_SCHEDULER` | Five related vars consumed by one module (`cleanup-scheduler.ts`). Bundle together; a single deprecation cycle covers the lot. Pattern is already proven by the two preceding migrations. |
| 4 | (new follow-up, not yet filed) | `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS`, `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` | Daemon-boot wiring — slightly higher risk because the reader runs before any tRPC routes exist. Move *after* the cleanup pattern is proven, and provide a sealed read at daemon-start (`daemon.config.load(db)`). |
| 5 | (new follow-up, not yet filed) | `FLUXAOS_TARGET_REPO_PATH` → `project.target_repo_path` | Per-project column. Different shape from the others (column, not `config_entry`). Run last so the operational-config pattern is settled before introducing per-project semantics. The existing whitelist in `src/server/routers/system.ts` (`ALLOWED_ENV_VARS`) gets removed in this slice. |

## Out of scope

- Actual schema migrations (FLX-222/223/224 and the two new follow-ups).
- Settings UI surface for the new keys (covered by FLX-89's System tab + future per-project settings tab).
- Removing the LAN auth bypass or the deploy bridge token from env. They stay env-only by design.
- Test-only vars (`FLUXAOS_TEST_*`, `FLUXAOS_MODEL`). These remain process-env fixtures.

## Acceptance check

- [x] Spec doc lives at `docs/superpowers/specs/2026-05-11-config-classification-design.md`.
- [x] Every `FLUXAOS_*` env var encountered by the audit is named and classified.
- [x] For every operational and per-project var, the DB target (table + key/column) is named.
- [x] Migration order is sequenced to minimize boot breakage.
- [x] Out-of-scope items are listed.
