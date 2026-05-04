# Deep Review CRITICALs Session Handoff (FLX-117, FLX-118, FLX-121)

Date: 2026-05-04 (Pacific)
Operator: Joseph Pierce
Branch at start: `main`
Branch at end: `main`
SHA at start: `da2516d`
SHA at end (origin/main): `d5acef0`

## Session Boundary

Session-start marker: `session-start-2026-05-04T08:00:00-07:00.md` (newer than latest session-end `session-end-2026-05-04T06:30:00-07:00`). Boundary is clean.

## Scope

Three standalone CRITICALs from the deep review (FLX-113 epic) shipped in a single session via parallel worktrees. All three were data-integrity issues: non-atomic multi-table writes, missing DB indexes on hot-path FKs, and a race condition in comment number allocation. None required schema design decisions — they were straightforward remediations of identified anti-patterns.

## What Shipped

**PR #209 — `fix: wrap manual-run state/event writes in transactions (FLX-118)`** (merged 2026-05-04T07:31Z)

`src/core/orchestrator/manual-run.ts` had two write pairs (state-override + event, status-update + event) as independent calls. Both are now wrapped in `db.transaction(async (tx) => { ... })` with fresh service instances receiving `tx`. `createIssueService` and `createPipelineRunService` updated to accept `DbOrTx` following the established pattern from `skill.ts`. 3 files changed.

**PR #216 — `feat: add missing FK indexes and unique constraints (FLX-121)`** (merged 2026-05-04T07:31Z)

Added 3 indexes (`stage_run.pipeline_run_id`, `stage_run.pipeline_stage_id`, `event.stage_run_id`) and 2 unique constraints (`issue_comment(issue_id, comment_number)`, `provider(org_id, name)`) to the Drizzle schema. Migration `0018_flx_121_indexes.sql` generated and applied to Supabase Cloud. Indexes confirmed live in `pg_indexes`.

Note: the agent generated a contaminated migration file that included already-applied ALTER TABLE statements from FLX-106. The file was corrected (stripped to index-only SQL, renamed to `0018_flx_121_indexes.sql` with correct journal idx 18) and the commit amended before merge.

**PR #217 — `fix: serialize commentNumber allocation with FOR UPDATE in transaction (FLX-117)`** (merged 2026-05-04T07:42Z)

`issue-comment.ts` `create()` was allocating `commentNumber` with a separate `MAX()` read then `INSERT` — two round-trips with no lock. Fixed using the same pattern as `issue.ts` issue number allocation: `tx.execute(sql\`SELECT ... FOR UPDATE\`)` inside a transaction, then `tx.insert()` for the Drizzle-typed insert. The `comment_added` event insert is now in the same transaction too (no more partial-write window). The unique index on `(issue_id, comment_number)` from FLX-121 is the last-resort guard. 1 file changed, unused `recordEvent` helper removed.

## Open PRs / Protected Branches

- `origin/flx-88-linear-mcp-fallback` — 1 commit ahead of main, PROTECTED. Predates this session; unrelated.

## Incidents & Root Causes

- **FLX-121 migration contamination**: The subagent ran `db:generate` against a schema that included columns already applied to the DB by a prior migration (FLX-106's `playbook_path`, `playbook_scope`, `result_doc`). Drizzle generated a migration that included both the new indexes and those already-applied ALTER TABLEs. This would have caused `db:migrate` to fail on a fresh clone. Caught during post-agent review, corrected before merge. Root cause: `db:generate` diffs against the snapshot JSON, not the live DB — if the snapshot is behind (because prior migrations were applied directly rather than via the normal flow), it regenerates already-applied DDL. Always inspect generated migration SQL before running `db:migrate`.

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASS (all three branches) |
| `npx biome check` | PASS |
| `npx vitest run` | Pre-existing failures only (env/DB not set in CI context); no new failures |
| DB indexes live | PASS — confirmed via `pg_indexes` query post-migration |
| Working tree | Clean |
| Remote sync | Up to date |

## Current State

- HEAD: `d5acef0` on `main`, in sync with `origin/main`
- Working tree: clean
- Worktrees: main only
- Open PRs: none
- Protected remote branches: `origin/flx-88-linear-mcp-fallback`
- No stashes

## Roadmap State

Three CRITICALs from the FLX-113 deep review epic closed: FLX-117, FLX-118, FLX-121.

Remaining from the deep-review queue:
- **FLX-114** — LangGraph import in `src/core/` (DI boundary violation)
- **FLX-115** — Bootstrap DI wiring
- **FLX-116** — Worker state mutation
- **FLX-111** (Medium) — Triage as meta-stage
- **FLX-112** (Medium) — `flux:signal` removal
- **FLX-108** (Medium) — `'complete'` sentinel cleanup

## Files Touched This Session

| File | Change |
|------|--------|
| `src/core/orchestrator/manual-run.ts` | Two write pairs wrapped in transactions |
| `src/core/orchestrator/pipeline-run-service.ts` | Factory accepts `DbOrTx` |
| `src/core/services/issue.ts` | Factory accepts `DbOrTx` |
| `src/core/db/schema.ts` | 3 indexes + 2 unique constraints added |
| `drizzle/0018_flx_121_indexes.sql` | New migration |
| `drizzle/meta/0018_snapshot.json` | Updated snapshot |
| `drizzle/meta/_journal.json` | New journal entry at idx 18 |
| `src/core/services/issue-comment.ts` | `create()` rewritten with FOR UPDATE transaction |

## Memories Saved This Session

None new — all patterns here (DbOrTx, FOR UPDATE allocation, transaction wrapping) were already established in prior sessions.

## Suggested Next-Session Prompt

```
Continue fluxaOS from main (SHA d5acef0). Three deep-review CRITICALs shipped this
session: FLX-117 (commentNumber race), FLX-118 (manual-run transactions), FLX-121
(FK indexes + unique constraints).

Remaining deep-review items:
- FLX-116: worker state mutation (CRITICAL)
- FLX-114: LangGraph import in src/core/ — DI boundary violation (CRITICAL)
- FLX-115: bootstrap DI wiring (CRITICAL)
- FLX-111: triage as meta-stage (Medium)
- FLX-112: flux:signal removal (Medium)
- FLX-108: 'complete' sentinel cleanup (Medium)

Protected remote: origin/flx-88-linear-mcp-fallback (unrelated, pre-existing).

Note on FLX-121: the migration journal has a pre-existing collision (two files each at
0016 and 0017 prefix from prior parallel-branch merges). Next migration is idx 18,
tag 0018_* — already used. Next new migration should use idx 19.
```
