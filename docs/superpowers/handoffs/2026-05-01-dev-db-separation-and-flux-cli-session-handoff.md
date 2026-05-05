# Dev DB Separation + Flux CLI Session Handoff

Date: 2026-05-01 (Pacific)
Operator: Joseph Pierce
Branch at start: `main` (SHA `955848a`)
Branch at end: `main` (SHA `27b8adb`)

## Session Boundary

Session-start marker: `session-start-2026-05-01T03:24:00-07:00.md`.

## Scope

This was an infrastructure and tooling session — no feature code shipped. The two main threads: (1) separating dev and UAT (formerly "prod") databases so nukes and seeds from the dev environment can't affect real-world test data, and (2) cleaning up the `flux` operator CLI with new commands and a naming convention change. A third discovery thread emerged mid-session: the migration chain had significant gaps (missing `organization`, `user`, rich issue model, and a dozen lookup tables) that made it impossible to migrate any fresh Supabase project. All gaps were backfilled.

## What Shipped

All changes were pushed directly to `main` (no PRs — operator infrastructure work).

**PR #247 — `test: add Brands RecordEditor journey test (FLX-126)`** (merged 2026-05-05T04:13Z)

Carry-forward from the previous session. The PR had been closed without merging. This session: rebased the branch to drop the stale flux helper commit (which had been superseded by the hardened version on main), opened a fresh PR with just the journey test, and merged. Only file touched: `e2e/brand-screenshot.spec.ts`.

**`fix: backfill missing migration chain gaps for fresh DB setup`** (`19502d4`)

The core infrastructure fix. Three categories of gaps were discovered and repaired:

1. **Missing `0005_org_and_user.sql`** — `organization`, `user`, and the entire rich issue model (`issue`, `issue_state`, `issue_status`, `issue_type`, `issue_priority`, `issue_label`, `issue_transition`, `issue_comment`, `issue_branch`, `issue_commit`, `issue_pull_request`, `stage_gate_result`) had no `CREATE TABLE` in any migration file. They were applied to prod directly during early development and never recorded. A new migration captures all of them with `IF NOT EXISTS` guards so it's a safe no-op on prod.

2. **`0002_harness_context_layout` missing from journal** — The file existed on disk but was not registered in `_journal.json`. Added at the correct position.

3. **`0009_r_epic` and `0018_flx_121_indexes` not idempotent** — These used bare `ALTER TABLE ADD COLUMN` and `CREATE INDEX` without `IF NOT EXISTS`, which fail when the column/index already exists (as they do on fresh DBs where `0005` creates the tables in their final form). Both made idempotent.

Additionally: `project.user_id`, `config_entry.project_id`, and `issue_event.actor` were missing columns discovered during seed validation.

The migration journal was renumbered to insert `0002` and `0005` at the correct positions. Prod ran clean (`migrations applied successfully`) after the fix.

**`feat: add flux server dev reset command`** (`031bf6e`)

`./flux server dev reset` — stops the server, runs `nuke.ts`, runs `db:seed`, then starts fresh. Fills the gap between `restart` (process-only) and the manual three-command sequence that was the prior workflow. Test coverage added to `tests/flux-cli.test.sh`.

**`refactor: rename prod to uat in flux operator CLI`** (`e2332a6`)

`flux server prod` → `flux server uat`. Variable names (`PROD_HOST` etc.) updated to `UAT_*`. Reflects that the Docker container at port 3003 is a UAT environment, not production traffic. Tests updated.

**`chore: update UAT DNS default to uat-flux.jdp21.com`** (`27b8adb`)

Updated the default `FLUX_UAT_DNS` from `flux.jdp21.com` to `uat-flux.jdp21.com`. Companion infrastructure work (Caddy + Cloudflare) was done in-session via `fhc caddy` and `fhc cloudflare` — `flux.jdp21.com` removed, `uat-flux.jdp21.com` added, Caddy reloaded.

## Incidents & Root Causes

**Fresh Supabase project couldn't migrate.** The dev DB separation effort immediately revealed that `db:migrate` silently hung on any new project. Root cause: drizzle-kit's spinner swallowed errors from `drizzle-orm/node-postgres/migrator`. Running the migrator directly exposed the actual error: `relation "issue_comment" does not exist` — the first symptom of the 12 missing `CREATE TABLE` statements. Required systematically comparing prod schema against migration files to identify every gap.

**Session pooler vs direct connection confusion.** New Supabase projects don't have IPv4 direct connections without a paid add-on. Spent time diagnosing why drizzle-kit hung before discovering that prod's `DIRECT_URL` already uses the session pooler (`aws-1-us-west-2.pooler.supabase.com:5432`), not a true direct connection. The new dev project uses the same pooler pattern.

**Cloudflare `add-a` double-appended domain.** `fhc cloudflare add-a uat-flux.jdp21.com 192.168.54.101` created `uat-flux.jdp21.com.jdp21.com`. The convenience command auto-appends the domain. Correct usage is `fhc cloudflare add A uat-flux 192.168.54.101` (subdomain only, no domain suffix). Deleted the bad record and recreated correctly.

## Verification Matrix

| Check | Result |
|-------|--------|
| `db:migrate` on fresh dev project | ✅ Pass |
| `db:seed` on fresh dev project | ✅ Pass |
| `db:migrate` on prod (no-op) | ✅ Pass (`migrations applied successfully`) |
| `flux server dev reset` dry-run | ✅ Correct sequence |
| `tests/flux-cli.test.sh` | ✅ Pass |
| Dev server restart picks up new env | ✅ Running on dev DB |

## Current State

- HEAD: `main` at `27b8adb`
- Working tree: clean
- No stashes
- Local branches: `main` only
- Remote branches: `origin/flx-126-brands-journey-test` (squash-merged, safe to delete), `origin/flx-88-linear-mcp-fallback` (pre-existing, no open PR, safe to delete)
- Dev server: running at `http://192.168.54.101:3004` → **dev Supabase project** (`dpdjlnpvxkepkwzwuvim`)
- UAT: Docker container `fluxaos-web` at `uat-flux.jdp21.com` (port 3003) → **prod Supabase project** (`zesinfsluyxiwzldeffa`)
- Databases are now fully isolated

## Environment Changes

| Item | Before | After |
|------|--------|-------|
| Dev DB | Shared prod Supabase (`zesinfsluyxiwzldeffa`) | Dedicated dev Supabase (`dpdjlnpvxkepkwzwuvim`) |
| UAT DNS | `flux.jdp21.com` | `uat-flux.jdp21.com` |
| `flux server prod` | existed | renamed to `flux server uat` |
| `flux server dev reset` | did not exist | nuke + seed + start |

## Files Touched

- `drizzle/0005_org_and_user.sql` — new baseline migration (created)
- `drizzle/0009_r_epic.sql` — made idempotent
- `drizzle/0018_flx_121_indexes.sql` — made idempotent
- `drizzle/meta/_journal.json` — inserted `0002` and `0005` entries, renumbered
- `.env` — updated to dev Supabase credentials
- `flux` — added `reset`, renamed `prod`→`uat`, updated DNS default
- `tests/flux-cli.test.sh` — updated for rename and new reset command
- `e2e/brand-screenshot.spec.ts` — carry-forward from PR #247

## Memories Saved

None new this session (existing memories cover the relevant patterns).

## Suggested Next Session

```
Continue from main at 27b8adb. Dev/UAT databases are now isolated:
dev → dpdjlnpvxkepkwzwuvim (new), UAT → zesinfsluyxiwzldeffa (unchanged).
`flux server dev reset` replaces the manual nuke+seed+start workflow.
DNS: uat-flux.jdp21.com (port 3003), dev-flux.jdp21.com (port 3004).

Next roadmap items: FLX-102 dogfood notes triage for actionable issues,
then post-alpha backlog (FLX-2, FLX-7, FLX-99) when direction confirmed.

Clean stale remote branches before starting:
  git push origin --delete flx-126-brands-journey-test flx-88-linear-mcp-fallback
```
