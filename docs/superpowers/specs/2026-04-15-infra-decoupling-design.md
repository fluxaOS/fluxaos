# R-INFRA: fh-commons Decoupling + Native Dev Tooling

**Date:** 2026-04-15
**Status:** Design
**Scope:** Remove fh-commons dependency, build native TypeScript dev tooling

---

## Problem

fluxaOS is a TypeScript/Next.js project using Supabase Cloud. fh-commons is a Python ecosystem built for local Postgres projects. The integration causes active harm:

- `flu db query fluxaos` hits a local Postgres instance, not Supabase Cloud — wasted an entire debugging session querying the wrong database
- `flu` is a 321-line Python shim for a project with zero Python code
- 180 synced files include 23 fh-commons docs, Obsidian skills, homelab templates, and Python test fixtures — none relevant to fluxaOS
- Synced files have "DO NOT EDIT" headers that prevent customization
- `fhc sync` can overwrite local modifications at any time
- No native way to inspect the app's actual database during development

## Decision

Full decoupling. fluxaOS becomes a standalone TypeScript project with no fh-commons dependency. Native TS scripts replace any lost functionality.

---

## R-INFRA-1: fh-commons Decoupling

### Step 1: Unregister from fh-commons

```bash
fhc project delete fluxaos --keep-directory --delete-forgejo --force
```

This removes:
- Entry from `/mnt/dev/fh-commons/config/projects.json`
- CLI symlink `~/.local/bin/flu`
- Forgejo repo `jpierce/fluxaos` (not needed — GitHub is the remote)

### Step 2: Delete dead artifacts

**Root files:**
- `flu` (Python CLI wrapper)
- `.fhc-config.json` (Forgejo config)
- `config/install.json` (fhc install metadata)
- `config/memory.json` (fhc memory system config)
- `config/shared.json` (fhc shared ecosystem config)
- Remove `config/` directory if empty after above

**Synced docs (23 files):**
- `docs/TESTING.md`
- `docs/agent-start-here.md`
- `docs/configuration-schema.md`
- `docs/configuration.md`
- `docs/database-management.md`
- `docs/development/branch-workflow.md`
- `docs/development/code-standards-enforcement.md`
- `docs/faq.md`
- `docs/forgejo-setup.md`
- `docs/git-commands.md`
- `docs/installation/README.md`
- `docs/installation/development-setup.md`
- `docs/installation/migration-guide.md`
- `docs/installation/project-integration.md`
- `docs/issue-tracker.md`
- `docs/memory-cli-reference.md`
- `docs/memory-system.md`
- `docs/pipeline-automation.md`
- `docs/pipeline-skill-model.md`
- `docs/project-management.md`
- `docs/troubleshooting.md`
- `docs/version-management.md`
- `docs/.DS_Store`

**Forgejo templates:**
- `.forgejo/` directory (6 issue templates referencing `flu`)

**Python test fixtures:**
- `tests/browser/__init__.py`
- `tests/browser/conftest.py`
- Remove `tests/browser/` if empty

**Dead git hooks:**
- `.git/hooks/post-commit` (skips non-fh-commons repos)
- `.git/hooks/post-merge` (skips non-fh-commons repos)

**Manifest:**
- `.claude/.fhc-sync-manifest.json`

### Step 3: Delete unused skills (both `.claude/skills/` and `.agents/skills/`)

- `archive-project/`
- `json-canvas/`
- `new-issue/`
- `new-project/`
- `new-stack/`
- `obsidian-bases/`
- `obsidian-cli/`
- `obsidian-markdown/`
- `sync-prod/`

### Step 4: Adopt + modify keepers

**Skills to keep (17 — in both `.claude/skills/` and `.agents/skills/`):**
- `agent-teams`, `check-logs`, `code-audit`, `defuddle`, `deploy`, `dev-status`, `finish`, `housekeeping`, `implement`, `research`, `restore-point`, `review`, `review-session`, `rework`, `start-of-day`, `end-of-day`, `verify-issue`, `verify-webapp`

**For each kept skill:**
1. Strip "DO NOT EDIT" / "maintained by fhc sync" headers
2. Replace `{{CLI}}` / `flu` references with native equivalents or TODOs
3. Remove references to fh-commons paths, Poetry, `fhc sync`

**Skills to rewrite for fluxaOS context (3):**
- `start-of-day` — strip fhc ecosystem daily workflow, make fluxaOS-native (read session-quick-start, check roadmap, check deferred-fixes)
- `end-of-day` — strip fhc ecosystem, make fluxaOS-native (update deferred-fixes, create session handoff if mid-work)
- `housekeeping` — strip fhc issue triage, make fluxaOS-native (audit deferred-fixes, check for stale TODOs, verify CLAUDE.md currency)

**Commands to keep (`.claude/commands/`):**
- All 7: `deploy`, `dev-status`, `implement`, `manager`, `research`, `review`, `rework`
- Same cleanup: strip fhc references, replace `flu` commands

**Hooks to keep:**
- `.git/hooks/pre-commit` — rewrite standalone (keep: lint, format, file size checks; remove: fh-commons sourcing, `flu test-gate`)
- `.git/hooks/pre-push` — rewrite standalone (keep: branch protection; remove: `flu pr` references)
- `.git/hooks/post-checkout` — keep as-is (worktree auto-push)
- `.git/hooks/checks/` — delete directory (sourced by old pre-commit)
- `.claude/hooks/session-start.md` — keep, strip fhc references
- `.claude/hooks/write-guard.sh` — keep as-is
- `.claude/settings.json` — keep, strip "managed by fhc" header

**Reference docs to keep (`.claude/`):**
- `E2E_TEST_STANDARDS.md` — referenced in global CLAUDE.md
- `ARCHITECTURAL_STANDARDS.md` (root) — keep, strip header

**Reference docs to delete (`.claude/`):**
- `README.md`, `BROWSER_TEST_STANDARDS.md`, `COMMAND_REFERENCE.md`, `CONSOLIDATED_REFERENCE.md`, `DEBUGGING_STRATEGIES.md`, `GIT_TIPS.md`, `QUICK_REFERENCE.md`, `TOOL_REFERENCE.template.md`, `WORKFLOW_GUIDE.md`

### Step 5: Update .gitignore

Remove any fhc-managed entries. Verify the gitignore is clean and complete for a standalone TS project.

### Step 6: Update CLAUDE.md and session-quick-start.md

- Remove fh-commons integration section from `session-quick-start.md`
- Update commands table if any scripts changed
- Remove `flu` from `.claude/settings.local.json` permissions

---

## R-INFRA-2: Native Dev Tooling

### DB Query Scripts

Location: `src/core/db/scripts/`

All scripts follow the established pattern from `nuke.ts`:
```typescript
import 'dotenv/config';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
```

| Script | npm script | Purpose | Output |
|--------|-----------|---------|--------|
| `issues.ts` | `db:issues` | Issues with state/status/priority joined | Formatted table |
| `runs.ts` | `db:runs` | Pipeline runs + stage runs with signals/exit codes | Formatted table |
| `gates.ts` | `db:gates` | Gate results with verdicts and reasons | Formatted table |
| `events.ts` | `db:events [id]` | Events for a stage run or issue | Formatted table |
| `inspect.ts` | `db:inspect <table>` | Raw rows from any table | JSON |

Design constraints:
- No interactive mode — pipe-friendly stdout
- No external dependencies beyond what's in package.json
- Accept CLI args via `process.argv` (no arg parser library)
- Clean exit after query (call `client.end()`)
- Formatted table output using simple column alignment (no `cli-table` dependency)

### npm scripts additions to package.json

```json
{
  "db:issues": "tsx src/core/db/scripts/issues.ts",
  "db:runs": "tsx src/core/db/scripts/runs.ts",
  "db:gates": "tsx src/core/db/scripts/gates.ts",
  "db:events": "tsx src/core/db/scripts/events.ts",
  "db:inspect": "tsx src/core/db/scripts/inspect.ts"
}
```

### Verification Test Scripts

Location: `tests/verify/`

These are NOT Vitest tests. They're standalone TS scripts that hit the real tRPC API or query the database directly and assert conditions. Run after nuke+seed or after stage runs.

| Script | npm script | What it checks |
|--------|-----------|---------------|
| `seed-check.ts` | `verify:seed` | After nuke+seed: 2 issues exist, correct states/statuses, pipeline stages configured |
| `gate-results.ts` | `verify:gates` | After a stage run: gate result row exists, verdict matches expected |
| `signal-handling.ts` | `verify:signals` | After hold run: issue state/status changed correctly |
| `run-all.ts` | `verify` | Runs all verify scripts in sequence, reports pass/fail |

Design constraints:
- Use direct DB queries (SupabaseDatabaseProvider), not tRPC — avoids auth/session complexity
- Print clear PASS/FAIL per assertion
- Exit code 0 = all pass, 1 = any fail
- No test framework dependency — plain assert + try/catch
- Each script is self-contained and runnable independently

### npm scripts additions

```json
{
  "verify": "tsx tests/verify/run-all.ts",
  "verify:seed": "tsx tests/verify/seed-check.ts",
  "verify:gates": "tsx tests/verify/gate-results.ts",
  "verify:signals": "tsx tests/verify/signal-handling.ts"
}
```

---

## What This Does NOT Cover

- **Skill rewrites for start-of-day/end-of-day/housekeeping** — listed as needing rewrite, but the actual content design is a separate task after decoupling
- **Replacing `flu issue`/`flu pr`/`flu memory`** — fluxaOS uses GitHub (gh CLI) for PRs, `deferred-fixes.md` for issues, claude-mem for memory. No replacement tooling needed.
- **UI reconciliation (R-UI)** — separate phase, comes after tooling is in place

## Implementation Order

1. R-INFRA-1 first (decoupling) — mechanical, low risk
2. R-INFRA-2 second (tooling) — depends on clean project state from step 1
3. Skill rewrites can happen during R-INFRA-2 or as a follow-up
