# R-REM-W2 Closeout — Session Handoff

**Date:** 2026-04-20
**Operator:** jpierce (with Claude Opus 4.7 · 1M context)
**Branch base at start:** `feat/r-rem-w2` at `3c6fc9e` (13 commits ahead of `main`, awaiting human browser verification)
**Branch base at end:** `main` at `a836be6`
**PRs opened + merged this session:** #43 (code), #44 (roadmap flip), #45 (planning-artifacts cleanup)

---

## Session Scope

Picked up yesterday's R-REM-W2 implementation session. The prior session finished all 9 implementation tasks (subagent-driven), staged a handoff doc, and stopped before opening the PR because invariant 21 (no self-certification) requires human browser verification for UI-affecting work. That verification was the entry point for this session.

Two bugs surfaced immediately when the user ran the dev server and tried to exercise the golden path. This session diagnosed and fixed both, added a regression-guard Playwright smoke, and then closed the branch out (PR, merge, roadmap flip, planning cleanup).

---

## What Shipped

### PR #43 — `feat/r-rem-w2` → `main` (code + R-REM-W2 core work)

Merged at `24cabba`. Net change: 19 files changed, +2,594 / -253. Full scope:

**From prior session (already committed at session start):**
- `SupabaseRealtimeProvider` adapter + `RealtimeProvider` port; `LiveOutput` and `RunDetailModal` route through `registry.get<RealtimeProvider>('realtime')` instead of importing `@supabase/supabase-js` directly.
- `SubprocessStdoutParser` adapter + `StdoutParser` port; relocated pure parsing logic out of `src/core/orchestrator/output-parser.ts` into `src/adapters/subprocess/stdout-parser.ts`. Orchestrator and `LiveOutput` resolve a parser from the registry based on the driver's `output_format`.
- `bootstrap-client.ts` split from server `bootstrap()` so `node:child_process` (transitive via `execa` in `SubprocessExecutor`) stays out of the client chunk.
- `issueCommentService.softDelete` wrapped in `db.transaction` so the soft-delete flag and version bump are atomic.
- Invariant-7 scope clarification in `docs/invariants.md`: `src/lib/` is framework glue (Next.js SSR, Supabase helpers, context resolution) and is exempt from the "vendor imports only via adapters" rule.
- Integration tests: `realtime.test.ts`, `stdout-parser.test.ts`, `issue-comment.test.ts`.

**This session (single follow-up commit `9d30797`):**
Two client-bundle bugs, both fixed in one commit:

1. **`bootstrap-client.ts` env-var read pattern.** The split file read env via `process.env[name]` with a dynamic string key. Next.js only inlines `NEXT_PUBLIC_*` into the client bundle when referenced as literal member expressions — dynamic lookups leave `process.env` as a compile-time empty object at runtime in the browser, so `requireEnv()` threw `Missing required environment variable: NEXT_PUBLIC_SUPABASE_URL` as soon as `RunDetailModal` or `LiveOutput` tried to resolve `realtime` from the registry. Fix: inlined the two literal reads via a `readPublicSupabaseEnv()` helper. Matches the existing pattern in `src/lib/supabase/client.ts`. Added a comment so the next agent doesn't revert.

2. **`stdoutParser` not registered in client registry.** The R-REM-W2 split grouped `stdoutParser` with the server-only adapters because all three adapters lived under `src/adapters/subprocess/`. But `SubprocessStdoutParser` is **pure logic** — type-only imports from `@/core/ports/stdout-parser`, no `child_process`, no fs, no execa. The concern was overcorrected. `LiveOutput.tsx` client component resolves `stdoutParser` from the registry to parse `stream-json` output. Fix: registered `stdoutParser` in `bootstrapClient()`. Added a comment clarifying that the adapter is pure-JS and why it's safe for the browser bundle.

**Regression guard:** `e2e/run-stage-smoke.spec.ts` (new). Loads issue #3, advances State to Research, clicks Run Stage, waits for RunDetailModal to render, and fails the test if any `pageerror` fires or if any browser-console error matches `/Adapter ".*" is not registered|Missing required environment variable|Missing Supabase config/`. Passes in ~3 seconds. Will fail loudly if either bug regresses.

### PR #44 — `docs/r-rem-w2-done` → `main` (roadmap flip)

Merged at `d04e12a`. Flipped the phases-table status cell to **Done — PR #43** and rewrote the What's Next narrative bullet to reflect the final scope, the two client-bundle follow-up fixes, and the verification matrix. Split into its own PR because `main` is protected against direct commits (standalone pre-commit hook rejects them).

### PR #45 — `docs/planning-artifacts-cleanup` → `main`

Merged at `a836be6`. Swept lingering planning artifacts that had accumulated across R-UI-2 / R-AUDIT / R-REM-W1–W2 sessions and were sitting in the working tree across sessions:
- Rename `docs/planning/mockups/pipeline-run-detail-mockup.svg` → `pipelines-run-detail-mockup.svg` (pure rename, 100% similarity).
- Add `docs/planning/mockups/issue-run-detail-output.png` — screenshot reference.
- Add `docs/superpowers/research/2026-04-18-archon-feature-analysis.md` — prior-art analysis of Archon (github.com/coleam00/Archon) feeding future R4/R5/R6 planning.

---

## Incidents & Root Causes Worth Remembering

### 1. Orphaned `next-server` holding `.next` cache open via NFS silly-rename

Dev server startup failed with "Unable to remove invalid database. Device or resource busy" and `rm -rf .next` failed with hundreds of `cannot remove '.nfsXXXXX': Device or resource busy` errors.

**Root cause:** An orphaned `next-server (v16.2.2)` process from a prior session (PID 3253316, started Apr 18) had file handles open in `.next/dev/cache/turbopack`. The project lives on an NFS mount, so the NFS client "silly-renamed" each deleted file to `.nfsXXXXXXXX` to preserve it until the process closes — exactly the symptom observed.

**Why `ps aux | grep next` missed it initially:** process name renders as `next-server (v1…` — the `v1` in the version prefix doesn't match the literal string `next`. Use `fuser -v <file>` to identify holders instead; it found PID 3253316 immediately.

**Fix:** `kill 3253316` → all `.nfs*` files cleared → `rm -rf .next` → retry. Not filesystem corruption; not a Next.js bug. Just an old process from days ago still alive.

### 2. `process.env[name]` vs `process.env.NAME` in Next.js client bundles

Next.js (Webpack / Turbopack) client-bundle compilation performs a static-analysis substitution pass on `process.env.*` references. Only literal member expressions get inlined. Dynamic string-key lookups (`process.env[someVar]`) are **not** substituted — `process.env` on the client is effectively an empty object except where the compiler inlined a literal. This is a well-documented but easily-missed constraint; server-side Node code has no such limitation.

**When it will bite again:** any helper function that takes an env-var name as a parameter and reads `process.env[name]`. Always inline literal member reads at the call site in files that ship to the client bundle. For server-only files this pattern is fine.

### 3. Over-eager server/client adapter split

R-REM-W2 moved the client bootstrap into `bootstrap-client.ts` to keep `node:child_process` out of the browser bundle. That was the right fix for the `SubprocessExecutor` adapter, which pulls `execa`. But `stdoutParser` (also under `src/adapters/subprocess/`) was grouped with the server-only set by directory heuristic, even though the parser is pure logic with zero node imports. Result: client components threw at runtime.

**Takeaway:** directory ≠ bundle safety. The signal is the actual import graph. When splitting bootstrap between server and client, verify each adapter's transitive imports (not just its directory) before deciding where it registers.

### 4. `gh pr merge` blocked by untracked files

`gh pr merge` does a local branch switch to update the working copy after the remote merge. That switch was refused because an untracked `src/core/orchestrator/output-parser.ts` was present — git would have been overwritten by the checkout. The file was a stale leftover from before the R-REM-W2 rename (`output-parser.ts` → `src/adapters/subprocess/stdout-parser.ts` in PR #43); not user work, not in `.gitignore`.

**What I did:** moved it to `/tmp/output-parser.ts.preR-REM-W2.bak`, merged, then user approved deletion. Already deleted.

**Preventative:** next time, do the `find .` sweep for stale untracked files during a session's initial triage, not at PR-merge time.

### 5. GitHub auto-delete didn't fire for `feat/r-rem-w2`

After `gh pr merge --delete-branch` reported success, the remote `feat/r-rem-w2` was still listed by `gh api repos/fluxaOS/fluxaos/branches`. Manually deleted via `git push origin --delete feat/r-rem-w2`. Root cause unclear — possibly a race with branch-protection settings.

**Preventative:** after every `gh pr merge --delete-branch`, run `gh api repos/<owner>/<repo>/branches --jq '.[].name'` to confirm the branch is actually gone. Don't trust the CLI's "deleted" message alone.

---

## Verification Matrix (at session end)

| Check | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` | clean | |
| `npx vitest run` | 122/122 passing | unchanged from handoff baseline |
| `npm run verify` | 10/10 (fresh seed) | ran after the user's browser-test residue to confirm seed asserts are clean |
| `npm run lint` | 54 problems | identical to `main`'s baseline |
| `npm run build` | compiles | verified in prior session; not re-run this session |
| `e2e/run-stage-smoke.spec.ts` | PASS in 3.2s | regression guard for the two client-bundle bugs |
| Human browser verification | **PASS** | user ran full golden path, reported all tests successful |

---

## Human UI Tests — Already Completed This Session

The user ran the full browser checklist before PR #43 was opened. All passed:

- [x] Login via Supabase session
- [x] Navigate to project
- [x] Create / edit issue (rich model, types, priorities, assignee, state dropdown)
- [x] Add comment, soft-delete comment (transactional softDelete fix verified via Activity feed)
- [x] Advance state New → Research so pipeline Run Stage becomes available
- [x] Click Run Stage → manual stage run triggers → RunDetailModal opens without `Missing env var` or `Adapter not registered` errors
- [x] LiveOutput streams events (realtime registry + stdout parser both resolving cleanly)
- [x] RunDetailModal open/close
- [x] Logout

No new human UI tests are required from this session's closeout work — PRs #44 and #45 are docs/planning only.

---

## Current State

- **HEAD:** `main` at `a836be6` (PR #45 merge commit), in sync with `origin/main`.
- **Local branches:** `main`, `feat/r-ui-2-impl` (paused work, intentionally kept — see below).
- **Remote branches:** `origin/main`, `origin/feat/r-ui-2-impl`. All other feature branches from this session deleted on both sides. Branch pruning (`git fetch --prune`) clean.
- **Worktrees:** one — `/mnt/dev/fluxaos` on `main`. No extras to clean up.
- **Working tree:** empty (`git status` shows clean).
- **Stash:** empty.
- **Dev server:** was running on `:3003` during this session; user can leave it or kill at discretion.
- **`/tmp/output-parser.ts.preR-REM-W2.bak`:** deleted.

### Paused work explicitly preserved

**`feat/r-ui-2-impl`** — Real-time updates phase, tasks 1–11 of 32 complete. Roadmap line 18 / line 61 describe the state. Prior roadmap note said "Resumption blocked on Wave 2 remediation." W2 is now done, so R-UI-2 is **technically unblocked** — but the R-AUDIT findings AUDIT-003 / -005 / -010 / -012 / -016 were against this paused code specifically. Before thawing, the next session should decide: resume R-UI-2 as-is, rebase it onto the post-W1/W2 `main` and re-audit, or fold the remaining scope into R-REM-W3/W4. This branch is **not** to be deleted.

---

## Roadmap State

R-REM-W2 row in the phases table reads **Done — PR #43**. What's-Next item 5 is rewritten with the full scope, the two client-bundle follow-up fixes, and verification results. No other phase statuses changed this session.

The What's Next ordering makes the **next phase R-REM-W3** (alpha-critical build — CLI, GitHub adapter, Anthropic adapter, 6 Settings tabs, Mission Control). W3 is currently *Scoped, not planned* — it needs brainstorming + plan authoring before execution. See the "Suggested next-session prompt" below.

---

## Files Touched This Session (code-level)

| File | Change | PR |
|---|---|---|
| `src/config/bootstrap-client.ts` | Inline literal `NEXT_PUBLIC_*` reads; register `stdoutParser`; update header docstring | #43 |
| `e2e/run-stage-smoke.spec.ts` | New regression-guard smoke | #43 |
| `docs/superpowers/roadmap.md` | Flip R-REM-W2 → Done; update What's Next narrative | #44 |
| `docs/planning/mockups/pipeline-run-detail-mockup.svg` | Rename → `pipelines-run-detail-mockup.svg` | #45 |
| `docs/planning/mockups/issue-run-detail-output.png` | Add | #45 |
| `docs/superpowers/research/2026-04-18-archon-feature-analysis.md` | Add | #45 |
| `docs/superpowers/handoffs/2026-04-20-r-rem-w2-closeout-session-handoff.md` | Add (this doc) | next commit |

---

## Memories Saved This Session

- `feedback_playwright_before_user.md` — Durable rule: run Playwright against the dev server to smoke UI fixes before handing off to the user for manual browser verification. Added to `MEMORY.md` index. Trigger: any fix that touches client-side bootstrap, registry, page-load, or any rendered route.

---

## Suggested Next-Session Prompt

```
fluxaOS session kickoff.

Recent context:
- R-REM-W2 shipped in PR #43, roadmap flipped in #44, planning
  artifacts cleaned up in #45. Current main is at a836be6.
- Full session handoff at
  docs/superpowers/handoffs/2026-04-20-r-rem-w2-closeout-session-handoff.md
  — read this first.

Before starting new work:
1. Read the handoff doc above.
2. Sanity check: `git status` clean, `git log main -3` shows the
   three merge commits from last session, `npm run verify` passes
   10/10 on a fresh seed.
3. Skim roadmap What's Next (items 2 and 6) to make the fork
   decision below.

The fork:

(a) R-UI-2 thaw. `feat/r-ui-2-impl` is paused at tasks 1–11 of 32.
    It was blocked on W2 remediation, which is now done. Before
    resuming, there are R-AUDIT findings against the paused code
    (AUDIT-003, -005, -010, -012, -016). Decide: resume as-is,
    rebase onto post-W1/W2 main and re-audit, or fold its
    remaining scope into W3/W4.

(b) R-REM-W3. Alpha-critical build: CLI (thin tRPC-client wrapper),
    GitHub adapter, Anthropic adapter, 6 Settings tabs, Mission
    Control. Scoped but not planned. This is the biggest phase in
    the roadmap; it deserves `superpowers:brainstorming` to
    decompose into slices before `superpowers:writing-plans`.

My recommendation: start with brainstorming on the fork itself —
"R-UI-2 disposition + R-REM-W3 decomposition" — rather than picking
one and sprinting. The outputs of that brainstorm will drive the
actual planning work.

If you disagree with the recommendation, push back before we start.
```

---

## End of Handoff
