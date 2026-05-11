# fluxaOS

AI orchestration OS — a config-driven engine that runs pipelines of AI-powered stages against issues. The engine is agnostic: it never knows stage names, provider names, or driver names. It reads config from the database and executes whatever the user configured.

> **New session?** Read [Session Quick-Start](docs/session-quick-start.md) first — conventions, gotchas, and database access rules.

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev -- -H 0.0.0.0 -p 3004` | Next.js dev server (port 3004 — prod/Docker owns 3003; `-H 0.0.0.0` required for LAN access) |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run db:generate` | Drizzle schema codegen |
| `npm run db:migrate` | Run migrations |
| `npm run db:seed` | Seed catalog data + default org/user/project |
| `npm run db:studio` | Drizzle Studio (DB browser) |
| `npm run db:issues` | List issues with state/status |
| `npm run db:runs` | List pipeline and stage runs |
| `npm run db:gates` | List gate results |
| `npm run db:events` | List events (all, or `-- --run <id>`) |
| `npm run verify` | Run all verification checks |
| `npm run verify:seed` | Verify seed data is correct |
| `npm run daemon` | Start the orchestrator daemon (foreground; systemd unit: `ops/systemd/fluxaos-daemon.service`) |
| `npx vitest` | Integration tests (real Supabase) |
| `tsx src/scripts/db/nuke.ts` | Drop all user data, keep schema |
| `npm run pipeline:init-result-doc` | Initialize a result doc for a stage run (debug/test) |
| `npm run pipeline:ingest-result-doc` | Ingest a result doc into the DB (debug/test) |
| `npm run cli -- <command>` | `fluxaos` CLI (thin tRPC HTTP wrapper). Requires `FLUXAOS_API_URL` set + `FLUXAOS_LAN_AUTH_BYPASS=1` on the server. See `src/cli/index.ts` for commands. |

## Architecture

```
src/
  cli/          # `fluxaos` CLI — thin tRPC HTTP wrapper, no business logic
  core/         # Domain logic — services, ports, DB schema, gates, pipeline, orchestrator
  server/       # tRPC routers (root.ts, trpc.ts, routers/)
  adapters/     # Vendor integrations (supabase, bullmq, subprocess)
  app/          # Next.js App Router pages ([org]/[user]/[project]/...)
  components/   # React components (gates/, dashboard/, shared)
  lib/          # Client helpers (supabase client, tRPC client, context resolution)
  config/       # Bootstrap + adapter registry
  __tests__/    # Integration tests (real Supabase, no unit tests)
e2e/            # Playwright journey tests (the verification gate)
ops/            # systemd unit, git-hooks/, install-hooks.sh
docs/           # session-quick-start, invariants, planning, superpowers/
```

## Tech Stack

Next.js 16, React 19, TypeScript 5, tRPC v11, Drizzle ORM, Supabase Cloud (Postgres/Auth/Realtime), BullMQ + Redis, Tailwind CSS 4, Playwright E2E, Vitest integration tests.

## Key Principles

- **Agnostic engine** — no stage/provider/driver/enum literals in app code (seed data and adapters only)
- **Config-driven** — fail fast on missing config, no silent defaults
- **No fallbacks ever** — *"If the primary mechanism doesn't work, that's a bug to fix — not a scenario to code around."* No `?? 'default'` patterns, no fallback chains, no polling fallbacks, no degraded-mode / graceful-degradation alternatives. One path; if it fails, surface the error. See [`ARCHITECTURAL_STANDARDS.md` §2](ARCHITECTURAL_STANDARDS.md#2-no-fallbacks---fail-fast).
- **DI everywhere** — services are factories receiving `Database`, zero vendor imports in `src/core/`
- **Orchestrator vs Workers** — systemd daemon manages pipeline state; AI workers are read-only executors that report via comments
- **No unit tests** — integration tests against real Supabase only; see Agent Behavior
- **Edit, never Write** — never overwrite existing files; build missing endpoints instead of deleting UI

## Agent Behavior

@.claude/AGENT_BEHAVIOR.md

**Project-specific verification:** UI work uses Playwright journey tests in `e2e/`. Reference pattern: `e2e/real-anthropic-stage-run.spec.ts`.

**Canonical full-lifecycle journey:** `e2e/full-issue-lifecycle.spec.ts` files an issue via the UI and watches the pipeline run through every stage to `completed` against the running daemon (no test-side env vars, no spawned daemon — same surface as a human at the keyboard). It MUST be run and pass before any UI sign-off is requested or any UI-touching PR is merged. If it fails, work halts: no commit lands, no PR merges, no issue closes — the failure surfaces a real product bug that must be fixed first. (When fhc#3314 verify gate ships, this rule converges with `fhc verify`.)

## Workflow

- **First run:** `npm i` → set `.env` → `npm run db:migrate` → `npm run db:seed` → `npm run dev -- -p 3004`
- **Reset state:** `tsx src/scripts/db/nuke.ts` → `npm run db:seed`
- **After schema changes:** `npm run db:generate` → `npm run db:migrate`

## R-RUNTIME env vars

Runtime deploy loop (file-issue → PR) requires these in `.env.local`:

- `FLUXAOS_GITHUB_TOKEN` — PAT with `repo` scope. Deploy bridge fails fast if unset when it needs to open a PR.
- `FLUXAOS_TARGET_REPO_PATH` — absolute path to a local clone of the target repo on `main`. Stage-runner refuses to acquire an isolation env without it.
- `FLUXAOS_CLEANUP_SWEEP_INTERVAL_MIN` / `FLUXAOS_CLEANUP_STALE_DAYS` / `FLUXAOS_CLEANUP_SESSION_RETENTION_DAYS` / `FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS` — cleanup-scheduler thresholds. Scheduler refuses to start if any of the four are unset (logged warning, no crash — the rest of the app boots).
- `runtime.workspace_root` (DB-only, FLX-222) — override for where worktrees live, stored as a `config_entry` row (`scope='global'`, `project_id=NULL`, key `runtime.workspace_root`). Default value is jsonb `null` ("use in-project `<repo>/.fluxaos-worktrees/`"); set to an absolute path string via Settings → System. The seed inserts the row; the isolation provider fails fast if it's missing.
- `runtime.artifacts_root` (DB-only, FLX-223) — override for where per-run artifact directories live, stored as a `config_entry` row (`scope='global'`, `project_id=NULL`, key `runtime.artifacts_root`). Default value is jsonb `null` ("use in-project `<repo>/.fluxaos-artifacts/`" — auto-added to target repo's `.gitignore` on first acquire). Set to an absolute path string via Settings → System. The seed inserts the row; the isolation provider fails fast if it's missing.
- `FLUXAOS_TEST_TARGET_REPO` (e2e only) — `owner/repo` the deploy-touching journeys (r-runtime-deploy, r-smoke, manual-stage-chain, r-artifacts-chain) open + auto-close PRs against. Set to `fluxaOS/fluxaos` when dogfooding, or any disposable repo you control. Specs skip cleanly when unset.
- `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` — required when running the daemon. Positive integer, seconds to wait for in-flight stage runs to drain after SIGTERM. Daemon refuses to start without it (operator owns the drain window — no default).
- `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` (optional) — positive integer. If set, daemon runs `orchestrator.recoverOnStartup()` on that cadence to reap stale stage runs whose PIDs are dead. If unset, only the startup sweep runs.

Pipeline stages, routing, gates, skills, and deploy-stage behavior are DB-owned configuration seeded by `npm run db:seed`; there is no active file-backed pipeline directory to override.

## Issue Tracking

Linear is the source of truth for issues, deferred fixes, and post-alpha roadmap items (adopted 2026-04-26).

- **Workspace:** `rebos`
- **Team:** `fluxaOS` (key `FLX`)
- **Projects:**
  - **fluxaOS Post-Alpha Roadmap** — workstreams after alpha shipped 2026-04-25
  - **fluxaOS Deferred Fixes** — non-blocking cleanup and follow-ups
- **Access:** Linear MCP only. No CLI. List issues with `mcp__plugin_linear_linear__list_issues`, save with `mcp__plugin_linear_linear__save_issue`.
- **Branch convention:** `flx-NNN-short-slug` (e.g., `flx-42-fix-realtime-leak`).
- **Commit trailer:** include `Fixes FLX-NNN` (or `Refs FLX-NNN`) in the commit body when the work resolves a Linear issue.
- **Legacy:** `docs/superpowers/deferred-fixes.md` is frozen — historical record only. New findings go to the Linear "fluxaOS Deferred Fixes" project.

## Worktrees & Hooks

fluxaOS uses `git worktree` as the default isolation strategy when multiple agents work in parallel. Git hooks live in the tracked `ops/git-hooks/` directory (not `.git/hooks/`, which is per-clone and not shared with worktrees). Each worktree must point its config at the tracked dir before hooks fire:

```bash
bash ops/install-hooks.sh   # idempotent; sets core.hooksPath = ops/git-hooks
```

Run the installer once after `git clone` and once per `git worktree add`.

**Tracked git hooks (`ops/git-hooks/`):**

| Hook | Purpose |
|------|---------|
| `pre-commit` | Branch protection (no direct commits to `main` outside merge), ESLint on staged TS, 500-line file-size cap with documented exemptions, secret-file detection. |
| `commit-msg` | When `CLAUDE.md` is staged, require `claude-md-score: NN` trailer with `NN >= 90` (see "Editing This File"). |
| `pre-push` | Refuse direct pushes to `main`. PRs only. |
| `post-merge` | After merging into `main` (e.g., `git pull` after `gh pr merge`), auto-prune fully-merged local branches that aren't checked out in any worktree and aren't backing an open PR. |

**Branch & state audit (`ops/git-hooks/session-audit.sh`):**

The four-command snapshot — `git status && git stash list && git branch --list && git branch -r --list` — should always show only ACTIVE work and PROTECTED open PRs. The audit script enforces this contract:

- `bash ops/git-hooks/session-audit.sh report` — human-readable banner, classifies every branch as ACTIVE / PROTECTED / ORPHAN-MERGED / ORPHAN-DANGLING (worktree-aware: any branch checked out in any worktree is ACTIVE).
- `bash ops/git-hooks/session-audit.sh prune` — deletes only `ORPHAN-MERGED` branches (safe `git branch -d`); never touches dangling or open-PR branches.
- `bash ops/git-hooks/session-audit.sh json` — machine-readable output for tooling.

The audit runs automatically:

- **At every Claude Code SessionStart** via `.claude/hooks/session-start-audit.sh` (advisory, non-blocking — surfaces orphans the moment the agent kicks off).
- **After every merge into `main`** via `ops/git-hooks/post-merge` (auto-prunes ORPHAN-MERGED branches; leaves dangling branches for human attention).

**Stash convention:** `git stash push -m "<owner>: <reason>"` — unnamed stashes are flagged as orphans. Use `WIP:` or `PROTECTED:` prefixes for short-lived or never-drop entries.

## Editing This File

CLAUDE.md is load-bearing project memory. Every edit must clear the quality gate before commit.

1. After any edit to `/mnt/dev/fluxaos/CLAUDE.md`, invoke the `claude-md-management:claude-md-improver` skill (Claude Code: use the Skill tool with skill name `claude-md-management:claude-md-improver`).
2. The skill must score the file **≥ 90**. If it scores lower, apply the suggested improvements and re-run until ≥ 90.
3. Append a `claude-md-score: NN` trailer to the commit message (where `NN` is the final score). The pre-commit hook blocks commits that stage `CLAUDE.md` without this trailer.
4. The PostToolUse hook (`.claude/hooks/claude-md-gate.sh`) emits a reminder when `CLAUDE.md` is edited — heed it; do not commit until the score is captured.

## Reference

- **[Session Quick-Start](docs/session-quick-start.md) — READ FIRST: conventions, gotchas, env vars, ports, autonomy details**
- [Invariants](docs/invariants.md) — hard constraints + issue lifecycle + verification script
- [Roadmap](docs/superpowers/roadmap.md) — phase status, plans, specs, RCAs
- [Approved mockup](docs/planning/mockups/dashboard-mockup.html) — visual target
- All other planning docs: `docs/superpowers/{specs,plans,handoffs}/`
