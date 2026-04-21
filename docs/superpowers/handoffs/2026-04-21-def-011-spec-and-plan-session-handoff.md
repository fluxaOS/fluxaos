# DEF-011 Spec + Plan + Adversary Review — Session Handoff

**Date:** 2026-04-21
**Operator:** jpierce (with Claude Opus 4.7 · 1M context)
**Branch base at start:** `main` at `5ec6a69`
**Branch base at end:** `spec/def-011-liveoutput-payload-consumer` at `3fea4a2` — left in-flight for implementation next session (handoff PR opens separately)
**PRs opened this session:** none for feature work; handoff PR filed as part of this wrap-up

---

## Session Scope

Session was framed as the DEF-011 kickoff (LiveOutput re-parses event payloads, tool_call events render as plain text). The operator asked for design-first cadence: brainstorm → spec → writing-plans → adversary review → execute (deferred to next session). We completed the full planning arc but stopped before any code touched `src/`. The judgement call: the `writing-plans` skill recommends a worktree for implementation; I kept the session on the shared branch because the whole session was docs-only and the implementation starts next session anyway. No `src/` files modified.

Three commits on `spec/def-011-liveoutput-payload-consumer`:
1. `4e77458` — initial spec
2. `83074ac` — implementation plan
3. `3fea4a2` — adversary-review amendments (BLOCKING dependency-array fix + HIGH fallback-chain fix + several MEDIUM framing corrections)

The adversary pass was critical: it caught a dangling `rawLines.length` reference in the auto-scroll `useEffect` dependency array at `LiveOutput.tsx:158` that the plan would have failed `tsc` on. Also caught a verbose-mode UX regression where `completed`-event payloads would render as JSON blobs (fallback chain missed `summary` / `error` fields emitted by real `appendEvent` call sites).

---

## What Shipped

No feature code. Three commits on branch `spec/def-011-liveoutput-payload-consumer`, no PR yet, no merge to main.

### Commit 1 — `4e77458 docs(spec): DEF-011 LiveOutput payload-consumer design`

Path: `docs/superpowers/specs/2026-04-21-def-011-liveoutput-payload-consumer-design.md` (350 lines).

Sections: Problem, Design (chosen approach + 6 sub-sections covering orchestrator payload contract, LiveOutput consumer refactor, stderr styling, Raw JSON pane, journey-test tightening, verification plan), Files touched, Out of scope, Risks and mitigations, Success criteria.

Core decision: DEF-011 option (a) — LiveOutput stops re-parsing; consumes `event.payload` as a typed `TranscriptEntry` directly. Orchestrator drops the redundant `content` projection. Stderr gains an amber visual lane. Raw JSON pane rewritten to show all persisted events pretty-printed.

### Commit 2 — `83074ac docs(plan): DEF-011 LiveOutput payload-consumer implementation plan`

Path: `docs/superpowers/plans/2026-04-21-def-011-liveoutput-payload-consumer.md` (906 lines pre-amendment).

11 tasks:
1. Add `isStderr?: boolean` to `TranscriptEntry` port
2. Normalize orchestrator payloads (three `appendEvent` call sites)
3. Rewrite `LiveOutput.tsx` consumer (5 steps, eventually 6 after amendment)
4. Stderr amber styling in `raw` renderer
5. Raw JSON toolbar pane redesign
6. Journey-test assertion tightening
7. Mark DEF-011 RESOLVED in `deferred-fixes.md`
8–10. Verification (nuke/seed/verify → journey test → human browser)
11. PR + merge

### Commit 3 — `3fea4a2 docs(spec,plan): apply adversary-review amendments to DEF-011`

Delta: +54 / −5 across both files.

**Plan amendments:**
- **BLOCKING fix:** added Task 3 Step 3b to patch `LiveOutput.tsx:158` (auto-scroll `useEffect` dep array references deleted `rawLines.length`).
- **HIGH fix:** extended Task 3 Step 3 fallback chain from `content → message → text → JSON` to `content → message → text → summary → error → JSON`. Each branch justified against an actual orchestrator `appendEvent` call site (`stage-runner.ts:113, 336, 401, 449`).
- **MEDIUM fix:** corrected stale line-number commentary for Task 2 Step 2 (catch block is at line 285, not 287). Find-replace text unchanged and still matches verbatim.
- **Self-review appendix:** logged adversary findings applied vs. acknowledged vs. not-acted-on (with rationale).

**Spec amendments:**
- Corrected "forward-compatible" overstatement (pre-fix stderr rows have no `text` field under new renderer — render empty amber divs until nuked; acceptable for pre-alpha but the claim was wrong).
- Corrected "only two consumers of `payload`" — there's a third: `src/app/[org]/[user]/[project]/pipelines/[id]/page.tsx:314` (`formatEventPayload`). No functional regression, but the claim was inaccurate.
- Added Risks-table entries for: missed consumer, cosmetic invalid-signal-error normalization, verbose-mode silently dropping `gate_checked`/`heartbeat`/`timed_out`/`failed`/`cancelled`, probabilistic journey-test assertion.

---

## Deferred Findings This Session

None — no new deferred findings this session. Three items that an adversary agent surfaced are NOT filed as DEF entries because they were pre-existing observations (spec accuracy issues + plan correctness issues) that got resolved inline in commit 3fea4a2. If any of the plan's tasks break during implementation next session, new DEF entries are possible — but nothing from this session's work product warrants one.

---

## Open PRs Awaiting Action

| # | Title | State | Notes |
|---|-------|-------|-------|
| (handoff PR) | docs(handoff): DEF-011 spec+plan session handoff | opened as part of this wrap-up | merge after review |

No feature PRs. The DEF-011 implementation PR opens during the next session (Task 11 in the plan).

---

## Incidents & Root Causes Worth Remembering

### 1. Adversary review caught a dangling dep-array reference the plan would have failed `tsc` on

**Symptom:** Plan Task 3 Step 2 deletes the `rawLines` memo from `LiveOutput.tsx`. Plan Task 3 Step 5 runs `npx tsc --noEmit && npm run lint` and asserts "exits 0." The plan missed that `LiveOutput.tsx:158` has `rawLines.length` in a useEffect dependency array. Without a patch there, `tsc` errors with `Cannot find name 'rawLines'`.

**Root cause:** When authoring the plan, I grep-verified the major call sites for `rawLines` but didn't verify dependency-array usage. Dep arrays are easy to miss because they look like incidental references, not data consumption.

**What caught it:** the `superpowers:code-reviewer` adversary agent dispatched at session end with a prompt explicitly framed as "find what's wrong, I want friction not validation." It read the source files AND the plan and traced the `rawLines` identifier through every reference in `LiveOutput.tsx`. Would have been missed by any review pass that only checked the plan text against itself.

**Takeaway:** When a plan deletes an identifier, grep the target file for ALL occurrences — not just the primary call sites. Dep arrays, type annotations, and JSX attributes are the three most-missed categories. Add this to the `writing-plans` skill mental model: "deleting X? grep for `\\bX\\b` across the target file."

This was saved to memory as a feedback entry — see Memories Saved section.

### 2. Fallback chain for non-output event types was incomplete

**Symptom:** Plan Task 3 Step 3's new fallback chain was `content → message → text → JSON`. In verbose mode, `completed` events (`stage-runner.ts:401-406` writes `{exitCode, duration, skillSignal, summary}`) would render as `[completed] {"exitCode":0,"duration":45321,"skillSignal":"proceed","summary":"..."}` instead of `[completed] Read CLAUDE.md, did the work`.

**Root cause:** I designed the fallback chain from the spec, not from the actual `appendEvent` call sites. The spec's Section 2 didn't enumerate every non-output payload shape — it described the synthesis pattern without listing the exact field names used by each event type.

**What caught it:** same adversary agent, finding #3. It grep'd `appendEvent` calls across `stage-runner.ts` and compared field names against the fallback chain.

**Takeaway:** When writing a catch-all fallback (render whatever-we-get), enumerate the actual writers before enumerating the fallback's branches. "Work backward from producers, not forward from assumed shapes" is the rule.

### 3. "Forward-compatible" is a word that invites overclaiming

The spec initially said "old-shape events... are still valid TranscriptEntry records because the `...entry` spread already included every typed field." True for parsed stdout events. False for stderr — pre-fix stderr used `content`, not `text`, and had no `id` field. Under the new renderer, pre-fix stderr rows would render as empty amber divs.

**Takeaway:** "Forward-compatible" is a strong claim — it asserts behavioral equivalence across a schema change. If there's any non-load-bearing scenario where the claim doesn't hold, document it and qualify the claim. Don't let vibes-level compatibility reasoning slip into a written spec. The adversary caught this; I should have caught it during spec self-review.

### 4. Plan-authoring self-review catches some things but not all

The plan's own self-review at the bottom asserted "file line references are all concrete to the current state of `main` (verified via `grep` during authoring)." That was true for the big find-replace blocks — every one matched verbatim. It was NOT true for the parenthetical "currently lines 287-296" commentary (actual range: 285-296). The self-review discipline verified the find-blocks (which matter for execution) but not the commentary (which only matters for human readability).

**Takeaway:** self-review checklists should distinguish between "things that must be literally exact for the plan to execute" and "things that are correctness-nice-to-haves." The former gets verified via textual match; the latter via eyeball. Don't let "verified via grep" cover both categories — they need different discipline.

---

## Human UI Tests — Completed This Session

This session was docs-only — no source code, no UI changes, no tests touched. **Skipped per house style for docs/process-only sessions.**

The DEF-011 *fix* (next session) WILL require full human UI verification per the plan's Task 10. The plan's Task 10 specifies the exact checks (non-verbose transcript, verbose mode, Raw JSON, copy behavior, console check, stderr styling).

---

## Verification Matrix (at end of session)

| Check | Result | Notes |
|---|---|---|
| `npm run verify:seed` | not run | No source change; `feedback_no_self_certification.md` allows skipping for docs-only sessions where no shipped diff affects seed/verify paths |
| `npx tsc --noEmit` | not run | Docs-only session, no `.ts`/`.tsx` touched |
| `npx vitest run` | not run | Same |
| `npm run lint` | not run | Same |
| `npm run build` | not run | Same |
| `e2e/*.spec.ts` | not run | Same |
| Pre-commit hook on all 3 commits | passed | Automatic on each `git commit` |
| `git status` post-commit | clean | Working tree clean on `spec/def-011-liveoutput-payload-consumer` |
| `git stash list` | empty | |
| Adversary review of spec+plan | completed, findings applied in commit 3fea4a2 | 1 BLOCKING + 2 HIGH + 4 MEDIUM + 6 LOW. Critical ones fixed. |

The next session's implementation work will produce full verification matrix numbers (tsc, lint, journey test, human browser).

---

## Current State

- **HEAD:** `spec/def-011-liveoutput-payload-consumer` at `3fea4a2` (not yet pushed, not yet PR'd).
- **main:** at `5ec6a69` (last shipped session was process-cleanup + skills audit — PR #54).
- **Local branches:** `main` + `spec/def-011-liveoutput-payload-consumer` (the latter is this session's in-flight branch).
- **Remote branches:** `origin/main` only. Branch not yet pushed.
- **Worktrees:** one — `/mnt/dev/fluxaos` on `spec/def-011-liveoutput-payload-consumer`.
- **Working tree:** clean.
- **Stash:** empty.
- **Dev server:** not started this session. Next session starts one per the DEF-011 plan's Task 8.
- **GitHub Issues open:** zero (confirmed earlier this week; adoption deferred to post-alpha R7).

---

## Roadmap State

No roadmap rows changed this session. DEF-011 is tracked in `docs/superpowers/deferred-fixes.md`, not in `roadmap.md`. The R-REM-W3-a row on the roadmap remains "Done — PR #50" and the R-REM-W3 meta-phase row remains unchanged. What's Next item 7 (R-REM-W3 remainder, GitHub adapter first) is still next on the roadmap; DEF-011 is a small focused fix that pairs cleanly before that.

The roadmap update will land in the DEF-011 implementation PR (commit 7 of the plan, which marks DEF-011 RESOLVED in `deferred-fixes.md` but not in `roadmap.md` since it was never a roadmap row).

---

## Files Touched This Session

| File | Change | PR / Commit |
|---|---|---|
| `docs/superpowers/specs/2026-04-21-def-011-liveoutput-payload-consumer-design.md` | Created (350 lines, + 30 line adversary-amendment delta) | commits `4e77458`, `3fea4a2` |
| `docs/superpowers/plans/2026-04-21-def-011-liveoutput-payload-consumer.md` | Created (906 lines initial, +24 lines adversary amendments) | commits `83074ac`, `3fea4a2` |
| `docs/superpowers/handoffs/2026-04-21-def-011-spec-and-plan-session-handoff.md` | Created (this file) | handoff PR (part of wrap-up) |

No source code, no adapter code, no UI code, no test code modified. Branch `spec/def-011-liveoutput-payload-consumer` contains these three files' worth of changes.

---

## Deferred Findings Captured

None this session. See "Deferred Findings This Session" above for explanation.

---

## Memories Saved This Session

- `/home/jpierce/.claude/projects/-mnt-dev-fluxaos/memory/feedback_plan_deletion_grep.md` — NEW. When a plan deletes an identifier, grep the target file for all occurrences (dep arrays, type annotations, JSX attrs are the most-missed categories), not just the primary call sites. Reference: this session's BLOCKING adversary finding re: `rawLines.length` in `LiveOutput.tsx:158` useEffect dep array.
- `/home/jpierce/.claude/projects/-mnt-dev-fluxaos/memory/feedback_fallback_from_producers.md` — NEW. When designing a catch-all fallback chain (render-whatever-we-get patterns), enumerate the actual writers first, then the fallback branches. Don't design from the spec's examples — design from grep of the producer sites. Reference: this session's HIGH adversary finding re: `summary` / `error` missing from fallback chain.
- `/home/jpierce/.claude/projects/-mnt-dev-fluxaos/memory/MEMORY.md` — two new index entries added for the above.

**Pending save** (would-be entries that are already captured in the handoff's Incidents section; not worth duplicating to memory):
- Forward-compatibility overclaim (Incident #3) — too contextual to DEF-011; doesn't generalize.
- Self-review discipline split (Incident #4) — interesting but the `writing-plans` skill already has a self-review section; would require skill rewrite to apply, and that's DEF-014 territory.

---

## Suggested Next-Session Prompt

See the copy-paste block delivered in the session response (Step 9 below).

---

## End of Handoff
