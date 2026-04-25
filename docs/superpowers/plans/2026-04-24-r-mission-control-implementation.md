# R-MISSION-CONTROL — Implementation plan

**Date:** 2026-04-24
**Spec:** [`../specs/2026-04-24-r-mission-control-design.md`](../specs/2026-04-24-r-mission-control-design.md)

---

## Plan-phase reconciliation

1. **Sidebar nav file is `src/components/nav.tsx`.** ✅ Confirmed; `mainLinks` array at lines 28-33. Adding a Mission Control link is a one-line append.
2. **`pipeline_run.status` allowed values include `pending`, `running`, plus the terminal set** (`completed`, `failed`, `timed_out`, `cancelled`) and `blocked`/`queued` reserved per `core/constants.ts`. ✅ MC reader needs to filter on `pending`/`running`/terminal-set; using the constants file directly avoids stringly-typed drift.
3. **`stage_run` columns we render: `id`, `pipelineRunId`, `pipelineStageId`, `status`, `startedAt`, `completedAt`, `createdAt`.** ✅ Schema lines 129-150. `pipelineStageId` joins to `pipeline_stage.name` for the stage label.
4. **`issue_pull_request` has all needed columns** (`id`, `issueId`, `prNumber`, `prUrl`, `title`, `state`, `headBranch`, `createdAt`). ✅ Schema lines 473-492. No router exists yet for this table — adding a read query in the new MC router is the smallest path.
5. **RealtimeProvider is registered + accessed via `registry.get<RealtimeProvider>('realtime')`.** ✅ `src/scripts/daemon.ts` line 132 + `src/components/pipeline/RunDetailModal.tsx` references it for stage-run subscriptions. Same pattern reused.
6. **`subscribeToTable(channel, table, event, cb)` is the existing API.** ✅ `src/core/orchestrator/event-orchestrator.ts` line 102 uses it; the unsub pattern mirrors there.
7. **TanStack `invalidateQueries` is available via `trpc.useUtils()`.** ✅ Existing dashboard uses `utils.project.list.invalidate()`. Same idiom for `utils.mission.summary.invalidate()`.
8. **`PIPELINE_RUN_TERMINAL` set is exported** from `src/core/constants.ts` lines 25-30. ✅ Reader can use it directly via `inArray(pipelineRun.status, [...PIPELINE_RUN_TERMINAL])`.
9. **No existing `mission` router.** ✅ `grep -r missionRouter src/server` returns nothing; root.ts has 14 routers, adding one is additive.
10. **`Realtime` invalidation cost across many tables.** ✅ Spec §7 — accept the cost for alpha. Single subscription per table; invalidates all four queries on any change. Debounce can come later in R-POLISH if needed.

**Plan-phase decisions on open questions (defaulted per AGENT_BEHAVIOR.md — no questions during a session):**

- **Page route: `/[org]/[user]/[project]/mission-control`.** Per-project, matches every other page. Cross-project rollup is post-alpha.
- **Single tRPC query (`mission.summary`) returns all four sections in one round-trip.** Faster than four parallel queries; single Realtime invalidation refreshes everything. The four-section data is small (≤30 rows total).
- **No pagination, no filters.** Hard cuts: 5 pending, 10 in-flight (in practice usually 0-2), 10 terminal, 10 PRs.
- **PR external link uses an icon button** (`ExternalLink` from lucide-react) opening `prUrl` in a new tab.
- **In-flight wall clock** updates client-side via `useEffect` + `setInterval(1000)` ticker that re-renders relative time. Doesn't trigger refetches.
- **Empty-state copy** taken verbatim from spec §R4.
- **Realtime subscribes both INSERT and UPDATE for `pipeline_run`** (lifecycle moves status), only INSERT for `issue_pull_request` (PR cache rarely updates pre-merge in alpha; UPDATE if needed in R-POLISH).
- **Live-validation gate moves to journey assertion-light:** like the R-DAEMON journey, the Playwright spec asserts the page renders and reacts to a real Run-Stage trigger. The "in-flight section populates" assertion is gated on `ANTHROPIC_API_KEY` (`test.skip` cleanly when unset). The empty-state assertion runs unconditionally.
- **No new sidebar icon.** Reuse `Activity` (already imported on the dashboard for the "Running now" stat). Keeps the bundle lean.

---

## Task breakdown

### Wave 1 — Mission-control reader (router + tests)

**T1.** Create `src/server/routers/mission-control.ts`:
- Export `missionRouter = router({ summary: publicProcedure.input(z.object({ projectId: z.string().uuid() })).query(...) })`.
- Inside the query:
  - Fetch all pipelines for the project (`pipeline.projectId = input.projectId`). If none, short-circuit to all-empty.
  - Fetch `pipeline_run` rows in three filtered batches: `status = 'pending'` LIMIT 5, `status = 'running'` (no limit — small in alpha), and `status IN PIPELINE_RUN_TERMINAL` LIMIT 10 ordered by `completedAt DESC` then `createdAt DESC`.
  - For each running run, find the most-recent non-terminal stage_run (mirror `getCurrentStageRun` from `pipeline-run-service.ts`). Join to `pipeline_stage.name`.
  - For each terminal run, find the last stage_run by `createdAt DESC LIMIT 1`. Join to `pipeline_stage.name`.
  - For PRs: fetch `issue_pull_request` rows whose `issueId` is in the project's issue set; ORDER BY `createdAt DESC LIMIT 10`. The join goes `issue.projectId = input.projectId`.
- Return shape per spec §R2 exactly.

**T2.** Register the router on `src/server/root.ts` as `mission`.

**T3.** Integration test `src/__tests__/integration/mission-control.test.ts`:
- Isolated org/user/project/pipeline fixture (same pattern as daemon.test.ts).
- Seed a stage to attach stage_runs to.
- Seed: 1 pipeline_run at `pending`, 1 at `running` with one launching stage_run, 1 at `completed` with a final completed stage_run, 1 `issue_pull_request` row attached to the project's seeded issue.
- Case A: call `mission.summary({ projectId })`; assert pendingRuns.length === 1, runningRuns.length === 1 (with currentStage non-null), recentTerminal.length === 1 (with finalStage non-null), recentPullRequests.length === 1 with matching `prUrl`.
- Case B: call `mission.summary` with a different projectId; assert all four arrays are empty.

**Commit:** `R-MISSION-CONTROL W1: mission-control reader (router + integration test)`.

### Wave 2 — Page route + client component

**T4.** Create `src/app/[org]/[user]/[project]/mission-control/page.tsx`:
- Server component, mirrors `src/app/[org]/[user]/[project]/page.tsx` shape.
- `resolveContext(org, user, project)` and pass `projectId`, `projectName`, `basePath` to a `MissionControlClient`.

**T5.** Create `src/app/[org]/[user]/[project]/mission-control/client.tsx`:
- `'use client'`. Imports `PageHeader`, `Card`, `EmptyState`, `StatusBadge`, `StatCard`, `Link`, `trpc`, `Activity` icon.
- Single `trpc.mission.summary.useQuery({ projectId })`. Loading state shows skeletons matching the four-section layout.
- Renders four sections per spec §R4:
  1. **Queue depth** card: large numeric `pendingRuns.length` + a list (pipeline name, issue title, queued time).
  2. **In-flight runs** grid of cards: one per running run, with run id, pipeline name, current stage badge, wall-clock since `startedAt` (live ticker), link to detail.
  3. **Recent terminal runs** table: pipeline name, issue title, final stage name, status badge, started time, duration, detail link.
  4. **Recent PRs** table: PR `#<number> <title>`, issue title, state, head branch, created time, external link.
- Wall-clock ticker: `useEffect` with `setInterval(1000)` to re-render relative timestamps. Cleanup on unmount.

**T6.** Empty states use `EmptyState` with copy: "Queue is empty — waiting for new runs," "No runs in flight," "No terminal runs yet," "No PRs opened yet."

**T7.** Add a "Mission Control" link to `src/components/nav.tsx` `mainLinks`, between Dashboard and Issues. Use the `Activity` icon (already commonly imported — verify). `href: ${basePath}/mission-control`.

**Commit:** `R-MISSION-CONTROL W2: page + client + nav link`.

### Wave 3 — Realtime auto-refresh

**T8.** Inside `MissionControlClient`, wire two Realtime subscriptions:
- `pipeline_run` INSERT + UPDATE → call `utils.mission.summary.invalidate({ projectId })`.
- `issue_pull_request` INSERT → same invalidation.
- Use `useEffect` with `[]` deps; resolve `realtime` via `registry.get<RealtimeProvider>('realtime')`. Match the pattern in `RunDetailModal.tsx` (subscribe → cleanup return-fn).
- Channel names: `mission-pipeline-run-insert`, `mission-pipeline-run-update`, `mission-issue-pr-insert` (must be unique to avoid Supabase channel collisions).

**T9.** Smoke against the dev server: load the page, open another tab, trigger Run Stage on issue #1, watch all four sections refresh within ~1s. Manual test only — not gated by integration.

**Commit:** `R-MISSION-CONTROL W3: Realtime subscriptions + invalidation`.

### Wave 4 — Journey + verification

**T10.** Playwright journey `e2e/r-mission-control.spec.ts`:
- Two cases.
- Case A (always-runs, no API key): nuke + seed → load `/mission-control` → assert `Mission control` heading visible, all four section headers render, all four empty-state copies render. Sanity assertion on the queue-depth "0" tile.
- Case B (`@daemon @journey`, skips when `!ANTHROPIC_API_KEY`): spawn daemon as child process (mirror `r-daemon-autonomous-run.spec.ts` setup), trigger Run Stage on issue #1, navigate to mission control, poll until queue depth == 0 (daemon picked up) and in-flight section has ≥1 run, then poll until ≥2 stages are completed (mirrors the new R-DAEMON journey assertion). Tear down daemon via SIGTERM.

**T11.** Run all gates:
- `npx tsc --noEmit` clean
- `npx vitest run` 248/248 (one new)
- `npx playwright test e2e/r-mission-control.spec.ts` Case A green; Case B green when `ANTHROPIC_API_KEY` set
- `npm run build` clean
- Pre-commit lint + 500-line cap green on every commit

**T12.** Update `docs/superpowers/roadmap.md`:
- Move R-MISSION-CONTROL to Done with spec + plan links in the table.
- Update "What's Next" → R-SMOKE.
- Append one sentence to current-engine-state paragraph: "Operators have a live mission-control view at /[project]/mission-control showing queue depth, in-flight runs, recent terminal runs, and PR links — all driven by Realtime subscriptions over the daemon's writes."

**Commit:** `R-MISSION-CONTROL W4: journey + roadmap`.

---

## Verification matrix per wave

| Gate | W1 | W2 | W3 | W4 |
|---|---|---|---|---|
| `tsc --noEmit` | required | required | required | required |
| `vitest run` | required (new test) | required | required | required |
| `playwright test e2e/r-mission-control.spec.ts` | n/a | n/a | n/a | required |
| `npm run build` | n/a | required | required | required |
| Pre-commit lint + 500-line cap | required | required | required | required |
| Manual Realtime smoke | n/a | n/a | required | required |

---

## Rollback strategy

Each wave is one atomic commit. If a wave breaks, `git revert <sha>` reverses it. No DB migrations, no env changes, no daemon changes — rollback is a pure code revert.

---

## Goal-backward verification

**Phase goal:** "One operator dashboard reading existing DB state the daemon already writes — queue depth, in-flight runs, recent terminal states, PR links."

| Goal element | Delivered by |
|---|---|
| One dashboard page | W2 — `mission-control/page.tsx` + `client.tsx` |
| Queue depth | W1 router `pendingRuns` + W2 render section 1 |
| In-flight runs | W1 router `runningRuns` + W2 render section 2 + W3 Realtime UPDATE |
| Recent terminal states | W1 router `recentTerminal` + W2 render section 3 + W3 Realtime UPDATE |
| PR links | W1 router `recentPullRequests` + W2 render section 4 + W3 Realtime INSERT |
| "Reading existing DB state" | W1 — read-only router, no schema, no daemon changes |
| Reactivity | W3 — Realtime subscriptions per spec §R3 |
| Verification | W4 — journey + tsc + vitest + build + lint |

Every goal element traces to a wave + a verification gate.
