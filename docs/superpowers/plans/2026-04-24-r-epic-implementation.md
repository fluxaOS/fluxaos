# R-EPIC — Implementation plan

**Date:** 2026-04-24
**Spec:** [`../specs/2026-04-24-r-epic-design.md`](../specs/2026-04-24-r-epic-design.md)

---

## Plan phase reconciliation

Before task breakdown, the plan phase verifies three spec claims against the live codebase:

1. **`issue` table has no `parent_issue_id` column.** ✅ Confirmed via `Read src/core/db/schema.ts` lines 381–418. Column set is `id, projectId, number, title, bodyMd, bodyHtml, stateId, statusId, typeId, priorityId, isClosed, assignee, author, labels, version, source, closedAt, createdAt, updatedAt`. Spec's "add self-FK" is required; the roadmap's "a few hours if schema already supports it" branch does not apply.
2. **fluxaOS has no autonomous work queue.** ✅ Confirmed via `grep "work.queue\|workQueue\|queueAdapter\|nextIssue\|dequeue" src/core/` → no hits. The single user-facing trigger is `pipeline.runs.trigger` in `src/server/routers/pipeline.ts`. Spec R-EPIC.R4 correctly places the epic guard at that mutation rather than inventing a queue.
3. **`issueService.transition` and `stateOverride` both centralize the close path.** ✅ Confirmed via `src/core/services/issue.ts` lines 437–567. Both write `isClosed: targetState.isTerminal` and emit a `state_changed` event via `recordEvent`. `maybeAutoCloseParent` hooking after the event emission in both methods covers all pipeline-driven and operator-driven closures. The skill-signal "already_complete" path in `src/core/orchestrator/manual-run.ts` also goes through `stateOverride` (line 91), so it's covered for free.

**DEF-019 (drizzle meta snapshot drift on main) is still open.** The migration in T1 is hand-written on top of generator output the same way 0007 and 0008 were. Journal entry appended manually. DEF-019 itself remains R-POLISH scope; this phase stays consistent with the existing workaround pattern.

**Plan-phase decisions on open questions (defaulted per AGENT_BEHAVIOR.md — no questions during a session):**

- **Trigger rejection error shape:** tRPC `BAD_REQUEST` with a machine-stable code string `ISSUE_IS_EPIC` in the message. UI matches on the string. Good enough for alpha; post-alpha the whole router can adopt structured error codes.
- **`hasOpenChildren` batching on list pages:** return an overlay map from a single dedicated procedure `issue.openChildCountsByParent(projectId)` instead of per-row round-trips. O(1) query.
- **"Create child" UX:** query param `?parent=<uuid>` on existing `/issues/new` page. No new wizard.
- **Activity-feed rendering of auto-close:** the feed already renders generic `state_changed` events. The additive event with structured `reason` payload gets a dedicated label in `ActivityFeed.tsx` ("Auto-closed — all children closed") when `reason === 'auto_close_all_children_closed'`. No event-shape migration needed.
- **Depth beyond 1 level:** schema tolerates, UI ignores grandchildren. Per spec §3.
- **Concurrency retry count on parent close:** 1 retry on `VERSION_CONFLICT`, then log+swallow. Operator can manually close parent if the retry storm is unlucky. Alpha-acceptable; noted in spec §8.
- **Seeded sample data:** don't seed a parent-child example in `src/scripts/db/seed.ts`. Operators exercise the feature via the journey test; flooding the seed with demo hierarchy pollutes the issue list.

---

## Task breakdown

### Wave 1 — Schema

**T1.** Extend `issue` table with `parent_issue_id` column + partial index in `src/core/db/schema.ts`. Self-FK is declared in-migration only (Drizzle's typing for self-FKs is awkward; a column-level `uuid` is enough for the type system). Run `npm run db:generate`, accept the generator's draft migration file, then **hand-edit** it to become `drizzle/0009_r_epic.sql` with: self-FK constraint (`ON DELETE RESTRICT`), `CHECK (parent_issue_id IS NULL OR parent_issue_id <> id)`, partial index `WHERE parent_issue_id IS NOT NULL`, trigger `assert_issue_parent_same_project`. Manually append the journal entry to `drizzle/meta/_journal.json`. Run `npm run db:migrate`. Verify with `npm run db:studio` the column and index exist, attempting a cross-project parent via psql raises the trigger.

**T2.** Rerun `npm run db:seed`; `npm run verify:seed` must stay 10/10 PASS — the seed check does not know about `parent_issue_id` but will fail if the migration somehow broke the issue table. If it goes red, fix before proceeding.

### Wave 2 — Service layer

**T3.** Add service methods in `src/core/services/issue.ts`:
- `getChildren(parentId)` — `select ... where parent_issue_id = parentId order by number asc`.
- `getParent(childId)` — read child row, return `null` if `parent_issue_id` is null, else load parent.
- `hasOpenChildren(parentId)` — `select count(*) ... where parent_issue_id = parentId and is_closed = false`, return `count > 0`.
- `countChildren(parentId)` — returns `{ open, closed }`.
- `openChildCountsByParent(projectId)` — `select parent_issue_id, count(*) filter (where is_closed = false) as open ... group by parent_issue_id` → return a `Map<parentId, openCount>`.

**T4.** Extend `create()` input to accept optional `parentIssueId`. When set, write it on insert. The trigger from T1 enforces same-project; the service additionally checks the referenced parent exists (returns a cleaner error than the raw Postgres FK violation). Add the same-project check in JS so the error message is user-friendly; the DB trigger is a safety net.

**T5.** Internal helper `maybeAutoCloseParent(childId: string): Promise<void>` in the same file. Logic per spec R-EPIC.R5 §5. Call site: the tail of `transition()` and `stateOverride()`, inside the same async function after `recordEvent` completes and the updated row is returned. Add a guard: only call the helper when the target state is terminal (otherwise a transition *opening* a child shouldn't recompute the parent). On VERSION_CONFLICT, retry once by re-reading the parent's row; if still not closed, retry the close; if that also conflicts, log `[epic] parent auto-close raced twice, manual close required` and return.

**T6.** Extend `getById()` to include a `hasOpenChildren: boolean` scalar in the response shape. Single extra `hasOpenChildren` query after the base row loads.

### Wave 3 — Router layer

**T7.** In `src/server/routers/issue.ts`:
- Add `getChildren`, `hasOpenChildren`, `openChildCountsByParent` procedures.
- Extend `create` input with `parentIssueId: z.string().uuid().optional()`.
- `getById` already passes through the service result — the `hasOpenChildren` field lands for free because `getById` returns whatever the service returns. Verify by reading the current shape.

**T8.** In `src/server/routers/pipeline.ts` `runs.trigger` mutation: first thing in the handler, call `issueService.hasOpenChildren(input.issueId)`. If true, throw `TRPCError({ code: 'BAD_REQUEST', message: 'ISSUE_IS_EPIC' })`. Keep the message exactly that string — the UI matches on it.

### Wave 4 — UI

**T9.** New component `src/app/[org]/[user]/[project]/issues/[number]/RelationshipsCard.tsx`. Props: `issueId`, `basePath`. Inside: `trpc.issue.getById.useQuery` for the parent/self info, `trpc.issue.getChildren.useQuery({ parentId: issueId })` for children. Renders:
- Parent row (if `parent_issue_id` is set) — fetch parent via `trpc.issue.getById` with that id, show `#N title` as a Next.js `<Link>`.
- Children list — each row `<Link href="{basePath}/issues/{number}">#{number}  {state?.label}  {title}</Link>`, closed children get `line-through` + `opacity-60`.
- "Create child issue" button linking to `{basePath}/issues/new?parent={issueId}`.
- If neither parent nor children exist, returns `null` (card not rendered).

**T10.** Wire `RelationshipsCard` into `src/app/[org]/[user]/[project]/issues/[number]/client.tsx`. Place between the issue header and `IssueDetailEditors`. Thread the `hasOpenChildren` flag down to the pipeline tracker as an `isEpic` prop.

**T11.** Update the pipeline-tracker component (`src/components/pipeline/PipelineTracker.tsx` or wherever "Run Stage" lives — confirm by grep during execution) so when `isEpic` is true, Run Stage is `disabled` and a muted note appears: "This issue has open child issues. Run pipelines on the children." Keep the button disabled on closed issues too (existing behavior if any — verify and match).

**T12.** Update `/issues/new` page (client) to read `searchParams.parent` and pass it into the `issue.create` mutation as `parentIssueId`. If present, show a small banner at the top: "Creating child issue under #N — <parent title>". The parent title comes from a `trpc.issue.getById` query.

**T13.** Update `/issues` list page to (a) render a "↳" prefix before the title when `parent_issue_id` is set and (b) render a " (N open)" suffix when `hasOpenChildren > 0`. Batch the children-counts via `trpc.issue.openChildCountsByParent(projectId)` so one query serves the whole list.

### Wave 5 — Verification

**T14.** Integration test `src/__tests__/integration/epic.test.ts` covering the 6 cases from spec R-EPIC.R9. Use the existing test setup — `resetDatabase` helper if present, or follow the pattern in `src/__tests__/integration/artifacts-inheritance.test.ts` which was added in the prior phase.

**T15.** E2E journey `e2e/r-epic-hierarchy.spec.ts`. Uses the `real-anthropic-stage-run.spec.ts` pattern but without any AI calls — this is a pure state-transition journey. Steps per spec R-EPIC.R10. Drives the browser against the LAN dev server.

**T16.** Run the full gate battery:
- `npx tsc --noEmit` — must be clean.
- `npx vitest run` — must be green, new tests included.
- `npx playwright test e2e/r-epic-hierarchy.spec.ts` — must be green.
- `npm run lint` — must be clean.
- `npm run build` — must succeed.
- `npm run verify` — must be 10/10.

### Wave 6 — Close-out

**T17.** Update `docs/superpowers/roadmap.md`: move R-EPIC from "Phases — Alpha" Next row into "Phases — Done" with a one-line summary (date, what shipped, journey link). Update the "Dependency ordering" sentence at line 64 to remove R-EPIC from "next."

**T18.** Squash-merge PR. Delete local + origin feature branch. Confirm clean main state per `AGENT_BEHAVIOR.md` Definition-of-Done: on main, in sync, working tree clean, no stale branches, no stashes, no worktrees except the primary. Write the handoff in `docs/superpowers/handoffs/2026-04-24-r-epic-session-handoff.md`.

---

## Wave dependency graph

```
T1 → T2 ─┐
         ├→ T3 T4 T5 T6 ─┐
         │               ├→ T7 T8 ─┐
         │               │          ├→ T9 T10 T11 T12 T13 ─┐
         │               │          │                        ├→ T14 T15 T16 ─┐
         │               │          │                        │                 ├→ T17 T18
```

Parallelism: Wave 2 tasks T3/T4/T5/T6 all touch `issue.ts` — execute sequentially to avoid conflict-heavy edits. Wave 3 T7 depends on T3–T6; T8 depends on T5 being wired (so `hasOpenChildren` exists). Wave 4 UI tasks T9–T13 can go in parallel only if agent isolation guarantees per-file edits; practically I'll do them serially because they're small. Wave 5 is strictly sequential (tests → gate battery).

---

## Risks

- **Drizzle self-FK typing.** If `.references(() => issue.id)` from within the `issue` definition causes a circular-reference compile error, fall back to declaring the column as a bare `uuid` in the schema and declaring the FK only in the migration. Spec §5.1 already anticipates this.
- **`executeManualRun`'s "already_complete" state override path.** It calls `stateOverride`. If the child is an already-complete signal issuer, the parent auto-close fires through that path too — intended behavior, because `stateOverride` is the canonical close path when a terminal transition happens without going through the transition table. Verify in T14 case 3 that this path also fires the auto-close.
- **`hasOpenChildren` timing in T8.** There's a tiny TOCTOU window between the check and `pipeline.runs.trigger`'s first DB write. For alpha, acceptable: the worst case is a run starts for an issue whose last open child closed a millisecond before the check, which is semantically fine (no children = not an epic). Not worth a transaction.
- **Activity feed label dependency.** T5's additive `state_changed` event with `reason: 'auto_close_all_children_closed'` must render in the feed. Check `ActivityFeed.tsx` handles unknown `reason` values gracefully before relying on the label — if it doesn't, add the label branch as part of T5 verification.
- **Cross-project parent via direct SQL / API bypass.** The DB trigger is the backstop. JS validation in T4 covers normal paths.

---

## Verification checklist (T16 battery)

| Gate | Command | Expected |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | clean |
| Unit/integration tests | `npx vitest run` | all green, includes 6 new R-EPIC cases |
| E2E journey | `npx playwright test e2e/r-epic-hierarchy.spec.ts` | PASS |
| Lint | `npm run lint` | clean |
| Build | `npm run build` | success |
| Seed check | `npm run verify` | 10/10 |
| Pre-commit | (automatic on commit) | passes lint + 500-line cap |

---

## Definition of done (phase-specific)

- All T1–T18 completed.
- PR #NN merged to main (squash).
- Local + origin feature branch deleted.
- Working tree clean, on main, in sync with origin.
- `docs/superpowers/roadmap.md` reflects R-EPIC in the Done table.
- Handoff document exists.
- Operator has opened the browser, manually created a parent-child relationship, attempted to run a pipeline on the parent, seen the rejection, closed the child, watched the parent auto-close.

---

**End of PLAN. Next: execute Wave 1.**
