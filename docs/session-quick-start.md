# Session Quick-Start

**Read this before doing anything.** These are conventions that every session must follow.

## Deferred Issues

Issues found during verification go to **Linear** — project **Bug Backlog** in team **FLX** (workspace `rebos`). Linear was adopted 2026-04-26. (There is no "fluxaOS Deferred Fixes" project — active projects are Alpha Release, Bug Backlog, Enhancements, Settings & config integrity, Post-Alpha Roadmap, Post-Alpha Wishlist.)

- Use the Linear MCP: `mcp__plugin_linear_linear__save_issue` to create, `mcp__plugin_linear_linear__list_issues` to query.
- Title: short, action-oriented (e.g., `UI: GateResultsPanel rule details show empty dots`).
- Body must include: **Found** (date + context), **Severity** (High/Medium/Low), **Location** (`src/path/to/file.tsx`), **What's needed** (the fix).
- Branch when picking up the work: `flx-NNN-short-slug`. Commit trailer: `Fixes FLX-NNN`.
- `docs/superpowers/deferred-fixes.md` is frozen — historical DEF-NNN entries only. Do not append new findings to it.

## Database Access

Use npm scripts to query the app's Supabase database:

- `npm run db:issues` — issues with state/status/priority
- `npm run db:runs` — pipeline runs with stage details and signals
- `npm run db:gates` — gate results with verdicts
- `npm run db:events` — events (all recent, or filtered by `--run <id>` / `--issue <id>`)
- `npm run db:studio` — Drizzle Studio (visual DB browser)

## Dev Server

Headless box. **UAT** (there is no production) runs in Docker on port **3003** (`fluxaos-web` container, deployed via `./flux server uat build`). **Dev** runs on port **3004** — always start with `npm run dev -- -H 0.0.0.0 -p 3004`. The `-H 0.0.0.0` is required; without it Next.js only binds IPv6 loopback and LAN clients get connection refused. Never start dev on 3003. From other machines: `http://192.168.54.101:3004` (dev) / `http://192.168.54.101:3003` (UAT). For Playwright runs against dev: `PLAYWRIGHT_BASE_URL=http://192.168.54.101:3004 npx playwright test`.

## Environment Files

- **`.env`** — checked into git template, holds Supabase URLs/keys (publishable only) and DB connection strings. Required: `DATABASE_URL` (transaction pooler, port 6543), `DIRECT_URL` (direct connection, port 5432, required for migrations), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- **`.env.local`** — gitignored, holds secrets like `ANTHROPIC_API_KEY` and `FLUXAOS_LAN_AUTH_BYPASS=1` (skip `/login` from LAN clients during Playwright runs). Next.js auto-loads `.env.local`; Playwright picks it up via `set -a; source .env.local; set +a` before invocation. Never paste these into prompts.

### R-RUNTIME configuration

The runtime deploy loop (issue → worktree → PR) pulls most of its knobs from the database; only a couple still live in `.env.local`. Full descriptions and defaults live under "R-RUNTIME env vars" in [`CLAUDE.md`](../CLAUDE.md) — this is the orientation table.

| Knob | Where it lives | What it controls |
|---|---|---|
| `FLUXAOS_GITHUB_TOKEN` | `.env.local` | PAT with `repo` scope. Deploy bridge fails fast when it needs to open a PR and this is unset. |
| `project.target_repo_path` | DB column on `project` (FLX-221) | Absolute path to each project's local target-repo clone on `main`. Edited via Settings → Projects. Stage runner throws `MissingProjectTargetRepoPathError` when null. No env fallback — operators upgrading from the pre-FLX-221 env var must copy the value into the column. |
| `runtime.workspace_root` | DB `config_entry` (`scope='global'`, FLX-222) | Override for worktree location. Default jsonb `null` means "use in-project `<repo>/.fluxaos-worktrees/`". Set via Settings → System. Isolation provider fails fast if the row is missing. |
| `runtime.artifacts_root` | DB `config_entry` (`scope='global'`, FLX-223) | Override for per-run artifact directories. Default jsonb `null` means "use in-project `<repo>/.fluxaos-artifacts/`" (auto-added to target repo's `.gitignore`). Set via Settings → System. |
| `cleanup.*` (5 rows) | DB `config_entry` (`scope='global'`, FLX-224) | Cleanup scheduler thresholds + on/off gate: `cleanup.sweep_interval_min`, `cleanup.stale_days`, `cleanup.session_retention_days`, `cleanup.artifacts_retention_days`, `cleanup.scheduler_enabled`. Thresholds re-read on every sweep; the boolean gate is read once at daemon boot (restart to flip). |
| `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` | `.env.local` (env-only) | Positive integer; seconds the daemon waits for in-flight stage runs to drain after SIGTERM. Daemon refuses to start without it. |
| `FLUXAOS_DAEMON_RECOVERY_SWEEP_INTERVAL_MIN` | `.env.local` (env-only, optional) | Positive integer; if set, daemon runs `orchestrator.recoverOnStartup()` on that cadence to reap stale stage runs whose PIDs are dead. Unset = startup sweep only. |

DB-backed config is seeded by `npm run db:seed`. There is no file-backed pipeline override — stages, routing, gates, skills, and deploy behavior are all DB rows.

### Dev vs UAT databases

Two Supabase projects back fluxaOS. Verify your env files point at the right one with `./flux env audit` (exits 1 with a clear remediation hint if they don't).

| Environment | Supabase project ref | DATABASE_URL host | Env file |
|---|---|---|---|
| **Dev** | `dpdjlnpvxkepkwzwuvim` | `postgres.dpdjlnpvxkepkwzwuvim@aws-1-us-west-2.pooler.supabase.com` | `/mnt/dev/fluxaos/.env.local` |
| **UAT** | `zesinfsluyxiwzldeffa` | `postgres.zesinfsluyxiwzldeffa@aws-1-us-west-2.pooler.supabase.com` | `/mnt/stacks/docker/fluxaos/fluxaos.env` |

`./flux env audit` extracts the project ref from each `DATABASE_URL` host and PASS/FAILs against the table. It also runs as part of `bash ops/git-hooks/session-audit.sh report` — run that manually at session start (the automatic SessionStart hook was retired with PR #396; the audit still fires automatically post-merge).

**Never reconstruct env files from a container's environment.** That's how FLX-123 happened: two recovery sessions read the UAT container's env, wrote it back to `.env.local`, and silently swapped dev to point at UAT. If an env file is corrupt or missing, restore from 1Password (`Agents/Supabase/dev info` and `Agents/Supabase/UAT info`) and re-run `./flux env audit` before doing anything else. (FLX-230)

## CLI Tools

Standalone TypeScript project — no `flu` CLI, no `fhc`. Use npm scripts (see Commands table in CLAUDE.md).

## Worktrees & Hooks

Parallel agent work uses `git worktree`. Git hooks are tracked in `ops/git-hooks/` (not `.git/hooks/`). After `git clone` or `git worktree add`, run:

```bash
bash ops/install-hooks.sh
```

This sets `core.hooksPath = ops/git-hooks` for the current worktree. Idempotent — safe to re-run. Without it, `pre-commit` / `pre-push` / `commit-msg` won't fire and the `claude-md-score` gate is bypassed.

## Verification — Long Form

CLAUDE.md says: "UI work requires a passing Playwright journey test in `e2e/`." The reasoning:

The original "no self-certification" rule existed because earlier AI agents shipped UI work that didn't function and claimed it did. The fix isn't "human must look" — it's "AI must produce mechanical proof." Playwright journey tests that simulate a user end-to-end ARE the proof. They click the buttons a user would click, open the modals they'd open, assert the rendered DOM, capture every `pageerror` and unexpected `console.error`. When that test passes, the work is verified.

**Reference implementation:** `e2e/real-anthropic-stage-run.spec.ts`. Patterns to copy:
- `test.skip(!HAS_API_KEY, ...)` so the spec is safe in environments without the key.
- `page.on('pageerror', ...)` and `page.on('console', msg => msg.type() === 'error' && ...)` capture, asserted at end of test.
- `expect.poll(...)` for state-transition waits (no arbitrary `waitForTimeout`).
- Selector strategy: structural (`role`, `aria-label`, `class` patterns) not text-only — text changes; DOM structure usually doesn't.
- A "knownErrorPattern" regex to filter out third-party noise while failing hard on regression-relevant errors.

**When you write a new journey test:** scope it to one user-visible journey, not a multi-page tour. Each spec file should be runnable in isolation, take <2 min, and read like a story (`navigate → act → wait → assert`).

**When the journey test is hard to write:** that's a real signal. Unstable selectors mean the UI lacks `aria-label` discipline; ambiguous assertions mean the spec needs sharper visible state; >5 min runtime usually means the test is testing too much. Surface these — they're architectural smells worth addressing.

## Autonomy — When to Consult, When to Decide

CLAUDE.md's "AI Authority" section is the rule. Long-form rationale:

The user wants this project ~95% AI-managed. Most "should I do X or Y?" questions agents ask are decisions the agent has the context to make and the user doesn't. Default to action.

**Things that genuinely need approval:**
- **Schema migrations.** Postgres migrations are essentially irreversible at scale. One bad migration = backup restore. Show the diff first.
- **New dependencies.** Each adds attack surface, build time, and maintenance burden. Cite why an existing package can't do it.
- **Roadmap changes.** The roadmap is a stated commitment; changing it changes the project's direction.
- **External pushes.** PRs to public repos, posts, anything that leaves a permanent trail outside this machine.

Everything else: pick, document, ship. If something later turns out wrong, the user will say so and you'll save that as a feedback memory. Iterating on actual decisions beats consulting on hypothetical ones.

## Gotchas

- **No fallbacks ever.** `?? '<default>'`, `value || fallback`, and `config.get(key, default)` are banned — fail fast on missing config with a clear error naming what's missing. Same rule for runtime: no polling fallback for Realtime, no degraded-mode / graceful-degradation alternatives. *"If the primary mechanism doesn't work, that's a bug to fix — not a scenario to code around."* See Invariant 9 in [`invariants.md`](invariants.md) and [`ARCHITECTURAL_STANDARDS.md` §2](../ARCHITECTURAL_STANDARDS.md#2-no-fallbacks---fail-fast).
- Optimistic concurrency required on all mutable entities (`WHERE version = $expected`)
- Events tables are append-only (immutable audit trail)
- Body HTML rendered at write time, never at read time
- Tenancy is UUID-only (FLX-239): projects are addressed as `/p/{projectUuid}/...` (e.g. `/p/00000000-0000-4000-8000-000000000001/issues/1`); org/user come from the session inside `resolveContext`, never from the URL. Slug columns were dropped in migration 0033.
- No production database — Supabase Cloud is the dev database. Nuke-and-seed freely.
- `appendEvent` is fire-and-forget — concurrent inserts commit out of producer order. Use `pipelineRunService.listEvents()` to read events; it merges stream + lifecycle events back into coherent order. (DEF-017, 2026-04-21.)
- Each pipeline run has two distinct directories. The **worktree** (`<target>/.fluxaos-worktrees/fluxaos__issue-<n>-<run-short>/`) holds the git checkout stages edit — everything committed to the target repo comes from here. The **artifacts dir** (`<target>/.fluxaos-artifacts/<runId>/`) is where stages hand off intermediate findings to each other (Research writes `research-findings.md`, Implement reads it and writes `plan.md`, Review reads the plan, etc.). Artifacts outlive the worktree; cleanup-service reaps them on a separate DB-backed retention window (`cleanup.artifacts_retention_days`). When debugging a run post-hoc, inspect the artifacts dir for what each stage thought it was doing. (R-ARTIFACTS, 2026-04-23.)
