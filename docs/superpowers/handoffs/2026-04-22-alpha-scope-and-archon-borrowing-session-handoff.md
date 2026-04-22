# Alpha Scope Reconciliation + Archon Prior-Art Session Handoff

**Date:** 2026-04-22
**Operator:** jpierce (with Claude Opus 4.7 · 1M context)
**Branch at start:** `main` at `b595cf5`
**Branch at end:** `docs/alpha-scope-and-archon-borrowing` at `05d01ba`, PR #67 open against `main`

---

## Session Scope

Started as a brainstorm-only session for R-REM-W3 slice (a) — the GitHub adapter — per the prior session's next-session prompt. The prompt explicitly named `superpowers:brainstorming` as the skill to invoke. What happened instead became, in sequence:

1. A ~4-question interactive Q&A round against the brainstorming-skill default flow
2. User-initiated interrupt: "that's not what AGENT_BEHAVIOR.md says to do"
3. Root-cause investigation into why agents keep entering interactive Q&A loops despite the "no questions during a session" rule
4. Discovery that Cole Medin's Archon project (`github.com/coleam00/Archon`, MIT, ~19k stars) had already solved most of fluxaOS's alpha plumbing concerns
5. Deep code-level inspection of Archon's workspace isolation, cleanup service, forge adapters, and headless runtime patterns
6. Strategic decision: continue fluxaOS (distinct product thesis) but borrow Archon patterns for plumbing
7. Joint roadmap restructuring — the ten-item alpha list, R-REM-W3 four-slice framing superseded
8. Four documentation commits capturing everything durable from the conversation

The session was supposed to end in a GitHub-adapter design spec. It ended in a roadmap-level scope reconciliation instead. User framing at hour six: "flux got off course a little, but in the right direction."

---

## What Shipped

**PR #67** — `docs: alpha scope reconciliation + Archon prior-art reference` — currently open against `main`.

Four commits, reviewable independently:

- **`2c6f10b` — `docs(research): add Archon prior-art reference`** (+220). New doc at `docs/superpowers/research/2026-04-22-archon-prior-art.md`. Catalogs the patterns fluxaOS intends to borrow from Archon (worktree lifecycle, isolation-environments DB shape, worktree-copy for gitignored files, cleanup service, forge adapter structure, headless runtime, stage-to-stage artifacts) with file pointers into `/mnt/dev/.forge/Archon/`. States what we deliberately do NOT borrow (YAML workflows, platform conversation adapters, Bun/monorepo packaging, chat adapters). Includes attribution policy.

- **`bbe37f4` — `docs(roadmap): restructure around alpha scope and Archon borrowing`** (+91/−66). Replaces R-REM-W3 meta-phase with eight concrete phases: R-RUNTIME, R-ARTIFACTS, R-EPIC, R-DAEMON, R-SETTINGS-ALPHA, R-MISSION-CONTROL, R-SMOKE, R-POLISH. Preserves Done-phase history. Adds Alpha Scope callout (one user, one project, one repo) and Prior Art callout at the top. Adds Post-Alpha section making deferrals explicit. Three new Lessons Learned (13-15): borrow rather than reinvent, headless runtime neutralises interactive skills, session-prompt language matters.

- **`1355802` — `docs(spec-v2): reconcile Alpha MVP Scope with 2026-04-22 roadmap`** (+61/−27). Adds Alpha Scope Reconciliation section. Rewrites Alpha MVP Scope checklist marking each original item Done / Scope-changed / Deferred / In-scope-as-<phase>. Adds seven alpha-required items missing from the original list.

- **`05d01ba` — `docs(disposition): mark R-REM-W3 four-slice framing superseded`** (+26/−1). Adds 2026-04-22 supersession note to the R-UI-2 disposition spec. R-UI-2 retirement and R-REM-W3-a reasoning stay authoritative; the four-slice framing is superseded.

**Also cloned locally** (not committed to fluxaOS — lives at `/mnt/dev/.forge/`, outside any git tree):

- `Archon/` — shallow clone of `coleam00/Archon` at main. Reference source for the prior-art catalog.
- `dark-factory-experiment/` — shallow clone of `coleam00/dark-factory-experiment`. Useful as a "what Archon looks like in practice on an unrelated project."

---

## The Ten-Item Alpha List (authoritative)

What fluxaOS needs for alpha — closing the "file an issue → get a PR" loop for one user, one project, one repo:

1. **Workspace + isolation layer** — worktree-per-run, isolation-env DB table, gitignored-file copy, cleanup service. (**R-RUNTIME**)
2. **Forge adapter (GitHub implementation)** — minimum 2 methods: `createBranch`, `createPullRequest`. (**R-RUNTIME**)
3. **Deploy bridge** — orchestrator commits + pushes + opens PR + records PR reference on the issue. (**R-RUNTIME**)
4. **Stage-to-stage artifact handoff** — `$ARTIFACTS_DIR` pattern from Archon. (**R-ARTIFACTS**)
5. **Epic / child-issue hierarchy** — verify/add `parent_issue_id`, orchestrator filter, auto-close-parent on last-child-close. (**R-EPIC**)
6. **Systemd orchestrator daemon** — wrap the currently-manual orchestrator as a long-running process consuming from BullMQ. (**R-DAEMON**)
7. **Minimum settings surface** — 2 tabs (Projects, Pipelines). Four others deferred. (**R-SETTINGS-ALPHA**)
8. **Mission Control** — one page reading existing orchestrator state. (**R-MISSION-CONTROL**)
9. **End-to-end smoke test** — Playwright journey proving the loop closes autonomously. (**R-SMOKE**)
10. **Cleanup / polish / ship docs** — whatever #9 surfaces. (**R-POLISH**)

Items 1+2+3 bundled as one phase (R-RUNTIME) because tightly coupled — no subset ships useful alone.

---

## Strategic Decisions Locked In

- **Alpha scope = one user, one project, one repo.** Schema supports multi; UI/flows don't.
- **Continue fluxaOS, don't adopt Archon wholesale.** fluxaOS's product thesis (rich issue model, DB-driven config, web-UI authoring for non-developers) differs from Archon's (YAML workflows, developer-first). Borrow plumbing patterns, keep our own product shape.
- **No fork.** MIT license would allow it; maintenance cost and upstream-tracking burden make it worse than building our own while referencing theirs.
- **`IssueProvider` port retired.** Same precedent as `AIProvider` deletion in R-REM-W3-a PR #50. Issues are fluxaOS-native, no external sync.
- **No IssueProvider does not mean "no forge adapter."** The forge adapter still matters for alpha — without it, worker-produced code dies in the worktree and never reaches a reviewable PR. Minimum 2 methods (`createBranch`, `createPullRequest`).
- **Merge-back-to-local design rejected.** Work stays in remote branches. PR opens, user reviews on GitHub, merges on GitHub, user pulls main to their local when they choose. Never automatic filesystem mutation of the user's checkout.
- **Dogfooding deferred.** fluxaOS managing its own development through its own pipelines is philosophically attractive but bootstrap-fragile. Revisit post-alpha.
- **No additional forge adapters for alpha.** GitHub only. GitLab/Gitea/Forgejo are post-alpha community-contributable under the same port.

---

## Incidents & Root Causes Worth Remembering

**1. AGENT_BEHAVIOR.md vs skill-body gravity.**

The superpowers:brainstorming skill's 500-line body (flowchart, 9-step checklist, red-flags table, "HARD-GATE" banners) overpowered AGENT_BEHAVIOR.md's 15-line declarative "no questions during a session" rule. Even though `using-superpowers` explicitly says user instructions beat skill defaults, in practice the heavier skill body won.

**Contributing factor:** the prior session's session-end next-session prompt explicitly said "Use `superpowers:brainstorming` skill to explore…" — a user-level imperative naming the conflicting skill. I followed it.

**Fix landed:** saved feedback memory at `feedback_agent_behavior_overrides_skills.md`, updated MEMORY.md index, and captured as Lesson #15 in the roadmap. Session-end next-session prompts should not name interactive skills; they should describe the work and let AGENT_BEHAVIOR.md drive the approach.

**Meta-level fix identified but not shipped:** the pattern where brainstorm → plan → execute → review each generate their own Q&A budgets cumulatively burns user time. The phase-boundary fix is "after spec+plan signoff, agents don't ask — they resolve ambiguities in code with rationale comments." Captured as Lesson #14 (headless runtime neutralises interactive skills, so the fluxaOS pipeline worker loop mechanically enforces this regardless of skill behavior).

**2. Cole Medin's Archon had already solved workspace isolation at production quality.**

Discovered during the session. The R-REM-W3 meta-phase spec (2026-04-20) named "GitHub adapter" as slice (a) but never surfaced workspace isolation as a distinct concern. Without isolation, the worker operates in fluxaOS's own source tree (as verified during R5.5 testing where seed issue #2 found real fluxaOS `/api/health/route.ts` endpoints). This is a design hole that existed for weeks but wasn't named.

**Fix landed:** R-RUNTIME phase created as the first alpha-critical deliverable, bundling workspace + forge + deploy. Archon patterns borrowed with attribution.

---

## Verification Matrix

Documentation-only session. No code changes, no schema changes, no test runs.

| Check | Result |
|---|---|
| Pre-commit hooks on all four commits | ✅ PASS |
| Roadmap reads coherently top-to-bottom | Subjective — PR review pending |
| Cross-doc references consistent (roadmap ↔ spec v2 ↔ disposition ↔ prior-art) | ✅ All four cross-link correctly |
| PR created and pushed | ✅ PR #67 |
| Attribution to Archon (MIT) present in every doc referencing borrowed patterns | ✅ Verified in each commit |

---

## Current State

- **HEAD:** `docs/alpha-scope-and-archon-borrowing` at `05d01ba`
- **PR open:** #67 against `main`
- **Local branches:** `main`, `docs/alpha-scope-and-archon-borrowing`
- **Remote branches:** `origin/main`, `origin/docs/alpha-scope-and-archon-borrowing`
- **Worktrees:** one — `/mnt/dev/fluxaos` on the docs branch
- **Working tree:** clean
- **Stashes:** empty
- **Dev server:** not running
- **Database:** untouched since session-start (no nuke/seed this session)
- **External clones:** `/mnt/dev/.forge/Archon/` and `/mnt/dev/.forge/dark-factory-experiment/` present outside git, to be kept as reference for R-RUNTIME planning

---

## Roadmap State

Structural restructure, not a phase-status change. All Done phases remain Done. The old R-REM-W3 meta-phase row is superseded; it's replaced by eight new alpha-phase rows. R-REM-W4 and R6 placeholders collapsed into R-POLISH.

No roadmap rows moved from "Not started" to "Done" this session.

---

## Files Touched

**New:**
- `docs/superpowers/research/2026-04-22-archon-prior-art.md` (+220 lines)
- `docs/superpowers/handoffs/2026-04-22-alpha-scope-and-archon-borrowing-session-handoff.md` (this file, pending commit)

**Modified:**
- `docs/superpowers/roadmap.md` (+91/−66) — restructure
- `docs/superpowers/specs/2026-04-07-fluxaos-spec-v2.md` (+61/−27) — alpha reconciliation section + checklist rewrite
- `docs/superpowers/specs/2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md` (+26/−1) — supersession note

**External (not committed):**
- `/home/jpierce/.claude/projects/-mnt-dev-fluxaos/memory/feedback_agent_behavior_overrides_skills.md` (new feedback memory)
- `/home/jpierce/.claude/projects/-mnt-dev-fluxaos/memory/MEMORY.md` (index updated to reference new memory)

---

## Memories Saved This Session

- **`feedback_agent_behavior_overrides_skills.md`** — Rule: AGENT_BEHAVIOR.md "no questions during a session" beats skill-default Q&A flows. Captures the mechanism (skill-body gravity, recency effect, procedural vs policy instructions) and the fix (make decisions autonomously with rationale in the artifact, let artifact review be the single correction gate).

No other memories saved — the session's substantive learnings (Archon patterns, alpha scope, phase restructure) are all captured in the committed docs, so no feedback memory needed.

---

## Suggested Next-Session Prompt

```
fluxaOS next session — R-RUNTIME planning.

Context: PR #67 captured the alpha-scope reconciliation and Archon-borrowing
direction. Please review and merge #67 first. Then the next roadmap phase is
R-RUNTIME — workspace isolation + forge adapter + deploy bridge — which is the
foundation the rest of alpha depends on.

Read:
1. docs/superpowers/roadmap.md — Phases — Alpha section, especially R-RUNTIME row
2. docs/superpowers/research/2026-04-22-archon-prior-art.md — Archon file pointers
3. Archon reference code at /mnt/dev/.forge/Archon/packages/git/src/worktree.ts,
   /mnt/dev/.forge/Archon/packages/isolation/src/providers/worktree.ts,
   /mnt/dev/.forge/Archon/packages/core/src/services/cleanup-service.ts,
   /mnt/dev/.forge/Archon/packages/isolation/src/worktree-copy.ts

Scope: plan R-RUNTIME end-to-end. Workspace isolation, isolation-environments DB
table, worktree-copy, cleanup service, minimum GitHub adapter (createBranch +
createPullRequest), deploy bridge. Produce an R-RUNTIME design spec.

Operate per AGENT_BEHAVIOR.md. No interactive skill invocations in the plan.
```

---

## End of Handoff
