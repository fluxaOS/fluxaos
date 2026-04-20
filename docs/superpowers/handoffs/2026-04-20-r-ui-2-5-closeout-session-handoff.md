# R-UI-2.5 Closeout — Session Handoff

**Date:** 2026-04-20
**Operator:** jpierce (with Claude Opus 4.7 · 1M context)
**Branch base at start:** `main` at `a836be6` (post-R-REM-W2 closeout, clean tree)
**Branch base at end:** `main` at `6dd90e3` (R-UI-2.5 squash-merged via PR #47)
**PRs opened this session:** #47 (R-UI-2.5 code + docs, merged) — plus this handoff PR about to open.

---

## Session Scope

Executed the session-kickoff fork decision from the R-REM-W2 closeout handoff. Two decisions to make:

1. What to do with `feat/r-ui-2-impl` — paused at tasks 1–11 of 32 with five R-AUDIT findings against it.
2. How to decompose R-REM-W3 (the biggest remaining remediation phase).

Brainstormed through `superpowers:brainstorming`, wrote a design spec and a concrete plan for the first sub-phase, executed the plan with `superpowers:executing-plans`, shipped. Two new phases were introduced as a result: **R-UI-2.5** (shipped this session) and **R-REM-W3-a** (scoped only; next session).

The brainstorm also re-scoped R-REM-W3 itself: its four remaining slices (GitHub adapter, CLI, 6 Settings tabs, Mission Control) become a meta-phase where each slice gets its own brainstorm + plan when reached, rather than one monolithic W3 plan.

---

## What Shipped

### PR #47 — `feat/r-ui-2-5-realtime-remnant` → `main`

Merged at `6dd90e3`. Net change: 12 files changed, +2,063 / –532. Full scope:

**Design + plan (committed first, rode the same PR):**
- `docs/superpowers/specs/2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md` — brainstorm outcome. Documents R-UI-2 retirement rationale, R-UI-2.5 scope, R-REM-W3-a scope, R-REM-W3 meta-phase framing, and ordering.
- `docs/superpowers/plans/2026-04-20-r-ui-2-5-implementation.md` — 9-task plan. Each task has exact file paths, complete code blocks, exact commands with expected output, atomic commits.

**R-UI-2 retirement (Task 1):**
- `docs/superpowers/specs/2026-04-16-r-ui-2-design.md` — prepended a SUPERSEDED terminal-state blockquote pointing forward to the R-UI-2.5 artifacts. File stays at its original path (not archived to subdirectory, matches project convention).
- `docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md` — same terminal-state note.

**Code (Tasks 2–5):**

1. **New file `src/app/[org]/[user]/[project]/issues/[number]/ActivityFeed.tsx`** (405 lines including its internal `CommentCard` helper + `formatEvent` + `catalogName` + `catalogForField`). Subscribes to the `issue_event` Postgres table through `registry.get<RealtimeProvider>('realtime')` and invalidates the events tRPC query on matching rows. Exposes `data-testid="activity-feed"` for e2e tests. Consumes `issueId` + `catalogs` props — no parent-owned state leaks.

2. **New file `src/app/[org]/[user]/[project]/issues/[number]/IssueDetailEditors.tsx`** (171 lines). Exports `EditableTitle`, `EditableBody`, `CatalogSelect` — the three inline editing primitives that lived in `client.tsx`. Cohesive slice.

3. **Modified `src/app/[org]/[user]/[project]/issues/[number]/client.tsx`** — 880 → 368 lines. Removed: 880-line hosting of the activity feed JSX, comment form, comment list, `CommentCard`, `formatEvent`, the catalog helpers, the three editing-primitive components, `eventFilter` + `commentBody` state, `eventsQuery` + `commentsQuery`, the three comment mutations (`createComment` / `updateComment` / `deleteComment`), and `eventsQuery.refetch()` from the `refetchIssue()` helper. Added: two imports and a single `<ActivityFeed issueId={issue.id} catalogs={{states, types, priorities}} />` render. Also fixed one pre-existing `@typescript-eslint/no-explicit-any` at the pipeline-stages map — the hook started flagging it once the file was touched.

4. **Modified `src/components/pipeline/RunDetailModal.tsx`** — deleted the `refetchInterval` block inside `trpc.pipeline.runs.get.useQuery`. The existing realtime subscription on `stage_run` at lines 124–140 already handles live updates. Four lines deleted, zero added.

**Tests (Task 5):**

5. **New file `e2e/activity-feed-realtime.spec.ts`** — posts a unique `smoke-test-<ts>` comment, asserts the feed row count grows without `page.reload()`, and asserts no `pageerror` + no registry/env-var console errors. Timeout at 45s on the testid-visibility check accommodates dev-server cold-compile on first hit.

6. **Modified `e2e/run-stage-smoke.spec.ts`** — pre-existing R-REM-W2 regression smoke. Updated from `/issues/3` to `/issues/1` because the seed no longer has `/issues/3` (current seed produces only #1 and #2). Also updated the issue-title regex to match. This change is unrelated to R-UI-2.5's code but necessary so the gate `run-stage-smoke passes` in the plan's verification matrix doesn't block on pre-existing breakage.

**Documentation updates (Tasks 7–8):**

7. **`docs/superpowers/deferred-fixes.md`** — struck through two entries, clarified a third, struck through a fourth:
   - "UI: Issue activity feed doesn't auto-refresh via Realtime" → RESOLVED (R-UI-2.5) citing PR #47.
   - "Adapter: RealtimeProvider not implemented" → RESOLVED (R-REM-W2, back-filled) citing PR #43. Should have been struck when W2 merged; captured now.
   - "UI: Pipeline detail modal duration doesn't update in real-time" → left header intact, appended an Update note that only the `useNow` live-elapsed tick remains open (the realtime subscription landed in W2).
   - "UI: Activity feed does not show correctly" → RESOLVED (R-UI-2.5, incidental) citing the Playwright smoke at commit `d5c4129` as the proof of rendering correctness.

8. **`docs/superpowers/roadmap.md`** — flipped R-UI-2 row to **Retired — superseded by R-UI-2.5 (branch archived)**, inserted R-UI-2.5 row as **Done — PR #47**, rewrote What's Next item 2 to the two-part R-UI-2-retired + R-UI-2.5-done narrative.

**Deferred findings captured (Task 9 addendum):**

9. **`docs/superpowers/deferred-fixes.md`** — added **DEF-009** and **DEF-010** based on browser verification this session (details under "Incidents & root causes" below).

---

## Incidents & Root Causes Worth Remembering

### 1. `AIProvider` port is dead — the "Anthropic adapter" deliverable was smaller than the R-AUDIT triage framed it

Exploration during brainstorming established: `src/core/ports/ai.ts` defines an SDK-shaped port (`complete` / `stream` / `listModels` / `healthCheck`) with **zero consumers**. The orchestrator's real AI invocation path is `executeStageRun` → `SubprocessExecutor` (the `StageExecutor` port) → `claude` binary → `SubprocessStdoutParser` (the `StdoutParser` port). Seed data already configures this path correctly — provider row "Anthropic" type `anthropic`, driver row `claude-code` binary `claude`, model row "Claude Sonnet 4.6", routing wired in. AUDIT-013's vendor-coupling concern was already resolved by R-REM-W2's parser relocation.

Under this architecture, the "Anthropic adapter" Pattern 2 triage item collapses to three small actions: delete the misfit `ai.ts` port, update the triage document with a resolution note, run an end-to-end journey with a live API key to prove the existing path works. That's **R-REM-W3-a** — scoped, not yet shipped. Session #, tokens small.

**Takeaway:** when a phase's "adapter" is actually just configuration + verification of an existing path, call it that. Don't build a parallel code path to match the triage's earlier framing.

### 2. Supabase Realtime payload shape caught only by the Playwright smoke

I wrote the `ActivityFeed.tsx` subscription callback referencing `payload.new?.issueId` — Drizzle field name. The Supabase Realtime adapter passes `payload.new` through verbatim, and Supabase delivers it with **DB-column names** (snake_case: `issue_id`), not Drizzle-shaped camelCase. Result: the filter matched nothing, the query never refetched on INSERT, the activity feed sat stale.

Critically, this bug slipped through: plan review, code self-review, `tsc --noEmit`, `vitest run` (no tests exercise realtime delivery to a browser), and `npm run build`. Only the new `e2e/activity-feed-realtime.spec.ts` caught it — the smoke posts a comment and asserts the feed grows, which requires the end-to-end chain (mutation → `issueEvent` row → Postgres publication → Supabase Realtime push → WebSocket → subscription callback → refetch → React render) to work.

**Fix:** accept both `issue_id` and `issueId` keys in the callback, on both `payload.new` and `payload.old`. Defensive, and resilient to any future adapter shape changes.

**Takeaway:** **e2e smoke is the only place this kind of end-to-end-chain drift surfaces.** Next time an adapter is added or modified, the smoke MUST be authored before the merge — not after. Building the smoke first would have caught this in minutes instead of hours. Save: `feedback_realtime_payload_shape.md` and update `feedback_playwright_before_user.md` to escalate from "run smoke before handoff" to "write the smoke while writing the feature."

### 3. Task 3 deviation: plan said "one cut," file-size invariant forced a second

Plan Task 3 Step 11 was a hard gate: `client.tsx` must be ≤ 500 lines post-extraction. After the ActivityFeed cut, the file was **534 lines** — 34 over. Plan's one-cut rule collided with invariant 10's hard ceiling.

Chose to extract a second cohesive slice (`EditableTitle` + `EditableBody` + `CatalogSelect` → `IssueDetailEditors.tsx`). The audit finding's original wording was "extract the activity feed **or another cohesive slice**" — the second cut stays within finding intent. Flagged explicitly in the commit message (`d1cc351`) per invariant 22.

Final line counts: `client.tsx` 368, `ActivityFeed.tsx` 405, `IssueDetailEditors.tsx` 171. All under 500.

**Takeaway:** when a plan has a hard invariant gate downstream, size-budget the plan upfront. Planning `client.tsx` would drop to ~500 lines via one cut was optimistic — should have computed "880 minus extracted LOC" ahead of time and flagged that the math was tight.

### 4. Pre-existing `process.env.FLUXAOS_LAN_AUTH_BYPASS` set up; port 3003 assumed but not guaranteed

Dev-server port is **3003** on this workstation per the user's convention, not the `playwright.config.ts` default of `:3000` (which is semaphore on this machine). I initially probed `:3000` and `:3003`, mis-read the `dhcpcd`-owned `next-server` on 3000 as a fluxaOS server (it was actually a semaphore process with the same binary name), and asked the user to kill it. User clarified. Restarted: own dev server on 3003 with `FLUXAOS_LAN_AUTH_BYPASS=1`, set `PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003` on each `playwright test` invocation. The existing memory entry `reference_lan_auth_bypass.md` already covered the port (3003); the mistake was trusting `ps | grep next` output over the memory entry.

**Takeaway:** memory entries about this project's runtime config are the authority. Save: new memory `reference_dev_server_port.md` pinning port 3003 explicitly, even though it's implied by `reference_lan_auth_bypass.md` — being explicit removes the port-guessing step.

### 5. Stale remote ref for the deleted feature branch

After `gh pr merge --squash --delete-branch` returned successfully and the remote confirmed the branch was gone, local `git branch -a` still listed `remotes/origin/feat/r-ui-2-5-realtime-remnant`. Fixed with `git fetch --prune origin`. Same issue flagged in the R-REM-W2 closeout handoff.

**Takeaway:** the R-REM-W2 preventative ("run `gh api repos/<owner>/<repo>/branches` after merge") is still right. Expand it: after confirming the remote is clean, also `git fetch --prune origin` to clear local stale refs in one step.

---

## Human UI Tests — Already Completed This Session

User ran the full R-UI-2.5 browser checklist before PR #47 merged. All core tests passed:

- [x] **Test 1** — Activity feed updates without manual refresh after posting a comment (AUDIT-012)
- [x] **Test 2** — `RunDetailModal` does not poll; updates via Realtime only (AUDIT-005)
- [x] **Test 3** — Page editing still works (title, description, state dropdowns, comments; `client.tsx` split not regressive)
- [x] **Test 4(1)** — Issues list renders
- [x] **Test 4(3)** — Dashboard renders

**Two findings surfaced during verification, both pre-existing, both captured:**

- **DEF-009** — Seeded issues display "No description. Click to add one." even when `bodyMd` exists, because seed writes `bodyMd` directly and bypasses the markdown → HTML render path the mutation API uses. `EditableBody` renders from `bodyHtml` in view mode. Fresh issues created through the UI always show correctly. Fix: route seed inserts through the renderer (option a: call the helper explicitly per insert; option b: route through the `createIssueService` equivalent, DRY win). Pairs with a future `npm run verify` assertion that every seeded issue has both `bodyMd` AND `bodyHtml`.

- **DEF-010** — Tag input on issue detail accepts only one tag; typing space or comma does not split into additional tags. Independent of R-UI-2.5 scope. Fix requires the tag component: split on space/comma/Enter, trim, de-dup, cap length, handle paste.

This closeout PR introduces **no code changes** — docs only. No additional human UI tests required for this PR.

---

## Verification Matrix (at PR merge)

| Check | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` | clean | zero errors |
| `npx vitest run` | 122/122 passing | unchanged from baseline |
| `npm run verify` | 10/10 (fresh seed) | no seed reset required during verification |
| `npm run lint` | 53 problems | **one fewer** than baseline 54 — pre-existing `any` at `client.tsx` was fixed incidentally during Task 3 |
| `npm run build` | compiles | no bundle-size warnings around new files |
| `e2e/activity-feed-realtime.spec.ts` | PASS in 2.1s | R-UI-2.5's new smoke |
| `e2e/run-stage-smoke.spec.ts` | PASS in 2.1s | existing R-REM-W2 smoke, retargeted to issue #1 |
| Human browser verification | **PASS** (with 2 deferred findings filed) | user ran the full checklist on `192.168.54.101:3003` |

---

## Current State

- **HEAD:** `main` at `6dd90e3` (R-UI-2.5 squash-merge), in sync with `origin/main`.
- **Local branches:** `main` only. `feat/r-ui-2-impl` retired and deleted both locally and remote per design. `feat/r-ui-2-5-realtime-remnant` auto-deleted by `gh pr merge --delete-branch`.
- **Remote branches:** `origin/main` only. Stale refs pruned with `git fetch --prune origin`.
- **Worktrees:** one — `/mnt/dev/fluxaos` on `main`.
- **Working tree:** clean.
- **Stash:** empty.
- **Dev server:** background process `b7nu45eu1` started this session on `:3003` with `FLUXAOS_LAN_AUTH_BYPASS=1`. User can leave running for next session or kill at discretion.

---

## Roadmap State

R-UI-2 row: **Retired — superseded by R-UI-2.5 (branch archived).**
R-UI-2.5 row: **Done — PR #47.**
What's Next item 2 (rewritten): R-UI-2 retired + R-UI-2.5 done summary.

Design spec `2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md` also introduced **R-REM-W3-a** (Anthropic port cleanup + live Claude journey) which is not yet tracked in the phases table but is the stated next phase in the ordering. This closeout PR adds an R-REM-W3-a row to the roadmap (see below).

---

## Files Touched This Session (code-level)

| File | Change | PR |
|---|---|---|
| `src/app/[org]/[user]/[project]/issues/[number]/ActivityFeed.tsx` | Create (405 lines) | #47 |
| `src/app/[org]/[user]/[project]/issues/[number]/IssueDetailEditors.tsx` | Create (171 lines) | #47 |
| `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` | Slim 880→368 lines; consume ActivityFeed + IssueDetailEditors; fix pre-existing `any` | #47 |
| `src/components/pipeline/RunDetailModal.tsx` | Remove `refetchInterval` block | #47 |
| `e2e/activity-feed-realtime.spec.ts` | Create | #47 |
| `e2e/run-stage-smoke.spec.ts` | Retarget `/issues/3` → `/issues/1` and update regex | #47 |
| `docs/superpowers/specs/2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md` | Create | #47 |
| `docs/superpowers/plans/2026-04-20-r-ui-2-5-implementation.md` | Create | #47 |
| `docs/superpowers/specs/2026-04-16-r-ui-2-design.md` | Prepend SUPERSEDED note | #47 |
| `docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md` | Prepend SUPERSEDED note | #47 |
| `docs/superpowers/deferred-fixes.md` | Strike 2 + clarify 1 + strike 1 + add DEF-009 + DEF-010; back-fill PR #47 | #47 |
| `docs/superpowers/roadmap.md` | Retire R-UI-2; add R-UI-2.5; rewrite What's Next item 2; back-fill PR #47 | #47 |
| `docs/superpowers/handoffs/2026-04-20-r-ui-2-5-closeout-session-handoff.md` | Create (this doc) | next commit (separate PR) |

---

## Memories Saved This Session

To be saved on handoff:

- **`feedback_realtime_payload_shape.md`** — Supabase Realtime delivers `payload.new` with DB-column names (snake_case), not Drizzle field names (camelCase). Always accept both shapes or normalize in the adapter.
- **Update `feedback_playwright_before_user.md`** — escalate rule from "run smoke before handing off" to "write the smoke while writing the feature, not after." e2e is the only place Realtime-chain drift surfaces.
- **`reference_dev_server_port.md`** — dev server runs on port 3003 on the homelab. `:3000` is semaphore; do not assume Playwright's default. Always export `PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003`.

---

## Suggested Next-Session Prompt

See the copy-paste block delivered in the session response.

---

## End of Handoff
