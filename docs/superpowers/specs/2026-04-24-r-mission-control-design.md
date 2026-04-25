# R-MISSION-CONTROL — Operator Dashboard

**Phase:** R-MISSION-CONTROL
**Status:** SPEC
**Created:** 2026-04-24
**Author:** Claude Opus 4.7 (1M)
**Depends on:** R-DAEMON (Done) — daemon writes the state this dashboard reads. R-EPIC (Done) — issuePullRequest table populated by deploy bridge.

---

## 1. Problem

The daemon writes the truth — `pipeline_run` transitions, `stage_run` lifecycles, `issue_pull_request` rows from the deploy bridge — but the operator has no single page that surfaces it. The existing project dashboard (`/[org]/[user]/[project]`) is product-experience-oriented: a "Just Do It" hero, success-rate KPI, recent runs table, issue breakdown. It hides the questions an operator actually asks while watching the daemon work:

- How many runs are queued waiting for the daemon?
- What's running right now, and on which stage?
- What just terminated, and did the deploy bridge open a PR?

Today the answer requires `npm run db:runs` + `npm run db:gates` + manual GitHub poking. R-MISSION-CONTROL gives the operator one page that answers all three.

Roadmap-stated scope: "One operator dashboard reading existing DB state the daemon already writes — queue depth, in-flight runs, recent terminal states, PR links. No new backend, no schema."

## 2. Goals

- One new page at `/[org]/[user]/[project]/mission-control` showing daemon-eye-view state.
- Four sections in priority order:
  1. **Queue depth** — count of `pipeline_run` rows at status `pending` (awaiting daemon pickup) + a list of the last 5.
  2. **In-flight runs** — `pipeline_run` rows at status `running`, with the currently-launching/running stage and stage start time.
  3. **Recent terminal runs** — last 10 runs at `completed`/`failed`/`timed_out`/`cancelled`, newest first.
  4. **Recent PRs** — last 10 `issue_pull_request` rows for the project, newest first, with click-through to the GitHub URL.
- Auto-refresh: each section subscribes to the relevant Realtime stream so the page reflects daemon activity within ~1s of a transition.
- One thin tRPC reader composing the four queries — no new domain logic. The router asks the DB and returns rows; UI renders.

## 3. Non-goals

- **Cross-project mission control.** Alpha is single-project; the route is project-scoped to match every other page. A cross-project rollup is post-alpha.
- **Drill-down into stage_runs from this page.** Mission control is overview-only. Click-through navigates to the existing pipeline-run detail page (`/[org]/[user]/[project]/pipelines/[id]`).
- **Manual run controls (cancel, retry).** Cancel exists on the pipeline run detail page already; mission control just links there.
- **Daemon health beyond DB state.** Whether the daemon is `systemctl active` is `journalctl --user -u fluxaos-daemon` territory, not a UI surface in alpha.
- **Provider/driver health rollup.** The existing dashboard's providers bar already covers this; mission control is run-state-focused.
- **KPIs (success rate, total cost, avg duration).** Already on the existing dashboard. Don't duplicate.
- **Cross-stage timeline visualization.** Out of alpha scope.
- **Filters / search / pagination.** Hardcoded "last N" cuts (5 queue, 10 terminal, 10 PRs). Operators wanting more open the Pipelines page.

## 4. Requirements

### R-MISSION-CONTROL.R1 — Page route and shell

- New page at `src/app/[org]/[user]/[project]/mission-control/page.tsx`.
- Server component that resolves the project context (mirrors `src/app/[org]/[user]/[project]/page.tsx`) and hands a client component the `projectId` + `basePath`.
- Client component lives at `src/app/[org]/[user]/[project]/mission-control/client.tsx`. Uses the existing `PageHeader`, `Card`, `EmptyState`, and `StatusBadge` components for consistency.
- Title: "Mission control". Subtitle: "Live daemon activity for `<project name>`".
- Sidebar nav (left) gains a "Mission Control" link between Dashboard and Pipelines. The nav lives at `src/components/nav.tsx` (`mainLinks` array).

### R-MISSION-CONTROL.R2 — Mission-control reader (tRPC)

- New router `src/server/routers/mission-control.ts`:
  - `mission.summary({ projectId })` returns:
    ```
    {
      pendingRuns:  PipelineRunRow[],            // status='pending', last 5
      runningRuns:  Array<{                       // status='running'
        run: PipelineRunRow,
        currentStage: { id, name, status } | null,
        startedAt: timestamptz | null,
      }>,
      recentTerminal: Array<{                     // status in terminal set, last 10
        run: PipelineRunRow,
        finalStage: { id, name, status } | null,
      }>,
      recentPullRequests: Array<{                  // last 10 issue_pull_request rows
        id, issueId, prNumber, prUrl, title, state, headBranch, createdAt
      }>,
    }
    ```
- All four queries scope to `projectId` via `pipeline.projectId` join (and `issue.projectId` for PRs).
- Read-only. No mutations on this router.
- Returns empty arrays cleanly when nothing matches (no nulls).
- Register on `src/server/root.ts` as `mission`.

### R-MISSION-CONTROL.R3 — Realtime auto-refresh

- Client subscribes to two Realtime channels via the existing `RealtimeProvider` / `registry`:
  - `pipeline_run` INSERT + UPDATE — invalidates the four queries.
  - `issue_pull_request` INSERT + UPDATE — invalidates the recent-PRs query.
- Subscriptions cleaned up on unmount (mirror `RunDetailModal` pattern).
- Fallback polling NOT used. Per project memory `feedback_no_fallbacks` — Realtime or nothing.

### R-MISSION-CONTROL.R4 — Render contract per section

- **Queue depth:** big numeric "N" + list of pending runs (pipeline name, issue title, time queued).
- **In-flight:** card per running run with run id, pipeline name, current stage (name + status badge), wall-clock since start, link to detail page.
- **Recent terminal:** table with columns Pipeline, Issue, Final stage, Result (status badge), Started, Duration, Detail-link.
- **Recent PRs:** table with columns PR (#number + title), Issue, State, Head branch, Created, External-link icon → GitHub.
- Empty states use `EmptyState` with copy: "Queue is empty — waiting for new runs," "No runs in flight," "No terminal runs yet," "No PRs opened yet."

### R-MISSION-CONTROL.R5 — No schema change, no daemon change

- Schema is untouched. The four queries read existing tables: `pipeline_run`, `stage_run` (for `currentStage`/`finalStage`), `pipeline` (for name), `issue` (for title), `issue_pull_request`.
- Daemon code is untouched. This is read-only over the truth the daemon already writes.
- No new env vars.

### R-MISSION-CONTROL.R6 — Verification

- Integration test `src/__tests__/integration/mission-control.test.ts` (NEW): seeds 1 pipeline_run at each lifecycle status + 1 PR row, calls `mission.summary`, asserts each list has the right rows and that scoping by another `projectId` returns empties.
- Playwright journey `e2e/r-mission-control.spec.ts` (NEW): loads the page with seed-empty state (asserts all four empty states render), then triggers a run via the existing Run-Stage flow on issue #1 (no API key dependency — test against UI state alone, asserting that the queue/in-flight sections populate as the daemon would; if no `ANTHROPIC_API_KEY` available, skip the daemon-driven half cleanly via `test.skip` per `r-daemon-autonomous-run` precedent).
- Live-validation gate: dev server up, daemon up, file a real issue, click Run Stage on issue #1, watch mission control update from queue → in-flight → recent terminal in real time. Assert the view-time-to-update is <2s on Realtime delivery (manual smoke; not gated by the journey).
- `npx tsc --noEmit` clean. `npx vitest run` 247+1 = 248/248 (one new). `npm run build` clean. Pre-commit lint + 500-line cap green on every commit.

## 5. Out-of-scope clarifications

- The roadmap line "queue depth (pending pipeline_runs)" is satisfied by R2's `pendingRuns` query. We do NOT introduce a separate "queue table" view; pending is just a status filter.
- "PR links" means rendering the URL with click-through, not embedding GitHub state. The PR table caches what the deploy bridge wrote (`state`, `mergedAt`); it does not call GitHub at render time.

## 6. Schema verification

| Column | Table | Verified? |
|---|---|---|
| `pipeline_run.status` | pipeline_run | yes (R-DAEMON regression fix) |
| `pipeline_run.pipelineId`, `issueId`, `startedAt`, `completedAt`, `createdAt` | pipeline_run | yes (used by listByProject) |
| `stage_run.pipelineRunId`, `pipelineStageId`, `status`, `startedAt`, `completedAt` | stage_run | yes |
| `pipeline_stage.name` | pipeline_stage | yes |
| `pipeline.name`, `projectId` | pipeline | yes |
| `issue.title`, `projectId` | issue | yes |
| `issue_pull_request.*` | issue_pull_request | yes (line 473-492 schema.ts) |

No migration. No backfill.

## 7. Risk and edge cases

- **Realtime delivery delay across many concurrent runs.** With 50+ concurrent runs the four invalidations could fire for each transition. Acceptable for single-operator alpha (typical concurrency: 1-2). If this becomes a problem, debounce in R-POLISH.
- **`stage_run.startedAt` may be null while status is `launching`.** Render "starting…" instead of an empty wall clock.
- **`issue_pull_request.state` evolves over PR lifetime.** The deploy bridge writes `open`/`merged`/`closed` already (R-EPIC). Just render whatever the column says.
- **Race between Realtime arrival and tRPC query refetch.** TanStack Query's `invalidateQueries` is idempotent; double-fires are benign.

## 8. Dependencies and integration points

- R-DAEMON (Done) — produces all the state being read.
- R-EPIC (Done) — `issue_pull_request` rows come from the deploy bridge wired up there.
- R-SETTINGS-ALPHA (Done) — uses the same nav layout pattern; no functional dependency.

## 9. Deferred

- **Cross-project rollup** when multi-project lands (post-alpha).
- **GitHub live state** — call the GitHub API for fresh PR state instead of trusting the cached column. Post-alpha.
- **Stage-level timeline** — visualizing which stage is currently running across all in-flight runs as a Gantt strip. Post-alpha.
- **Cancel from mission control** — currently click-through to detail page. Post-alpha if operators ask.
