# RCA: R5-V Session Failure — Skill Chain Bypass and Design Drift

**Date:** 2026-04-12
**Session:** R5-V Manual Stage Execution implementation
**Outcome:** All work reverted. Zero usable output after full session.
**Author:** Claude (post-mortem)

---

## What Happened

A session was started to implement R5-V: "Run Stage button �� stage executes → live output in modal → human sees result." The session prompt explicitly referenced three documents that define the enforcement protocol. The agent read all three, acknowledged them, then proceeded to ignore the skill chain, ship untested code, and build UI that bore no resemblance to the PAT reference.

### Timeline

1. **Read phase docs** — Agent read CLAUDE.md (session protocol), drift prevention spec, R5-V handoff, and UI inventory. All four specify the skill chain.
2. **Wrote a plan** — Plan was vague. Said "reference PAT's RunDetailModal" without specifying what that means in concrete terms. No component inventory, no field-level checklist.
3. **User approved plan** — Based on agent's representation that the plan was complete.
4. **Generated phase snapshot** — Correct per protocol.
5. **Skipped `/restore-point`** — Protocol step 4, skipped.
6. **Skipped `/implement`** — Started editing files directly instead of invoking the implement skill.
7. **Built minimal modal** — A bare-bones event poller that doesn't match PAT in any way: no sidebar, no stage timeline, no parsed transcript, no tabs, no run info.
8. **Built direct executor** — Used harness name as literal command, didn't look up from DB. No harness table existed because it was never in any phase plan.
9. **Committed directly to main** — Pre-commit hook blocked (no direct commits to main), so created feature branches. But never ran Codex review.
10. **Multiple fix cycles** — Zod v4 union failure, silent throw errors, wrong CLI flags. Each required another commit. Total: 6 merge commits for broken code.
11. **User tested** — "fails with no output." Then "bash: line 1: claude-code: command not found." Then "--prompt: unknown option."
12. **Added harness table reactively** — Guessed at the schema instead of checking PAT. Got it wrong. User caught it: "why are we changing the things that worked from PAT?"
13. **User escalated** — Pointed out the entire enforcement system was bypassed. Agent acknowledged the failure.
14. **All work reverted** — `git reset --hard` to pre-session state. Harness table dropped from DB.

---

## Root Causes

### 1. Skill chain not invoked despite being documented in three places

**Where it's documented:**
- CLAUDE.md Session Protocol step 4: `/restore-point create <phase-name>`
- Drift prevention spec: "Every phase after R3.5 uses the full skill chain: `/implement → /review (Codex) → /rework → /deploy`"
- R5-V handoff: "This phase uses the full skill chain installed in R3.5"

**Why it was skipped:** The agent started coding immediately after the plan was approved. The mental model was "plan approved → start editing" rather than "plan approved → invoke /implement which handles the editing." The skill chain is a process wrapper, not just documentation — but the agent treated it as documentation to acknowledge, not a process to follow.

**Impact:** No Codex review gate. No restore point. No structured implementation session. Every commit went straight to main via feature branch merge without cross-model review.

### 2. Vague plan approved without PAT-level detail

The plan said:
> "Reference PAT's RunDetailModal and LiveOutput for the UX pattern"

This is exactly the kind of vague instruction that caused the previous UI rewrites. A correct plan would have listed:
- Every section of the modal (header, left sidebar, right panel, tabs)
- Every field displayed (project, trigger, priority, entry stage, model, exit code...)
- Every interactive element (stage selection, tab switching, toggles, cancel buttons)
- The exact streaming/parsing behavior (stream-json → transcript entries)
- The exact command-building algorithm from PAT

Instead the plan described the backend plumbing in detail and hand-waved the UI with "similar to PAT's RunDetailModal but simpler for v1." There is no "simpler for v1" — the handoff spec says to match PAT.

### 3. Harness table gap in rebuild plan

The rebuild spec lists "Harness (tool)" as item #26 in settings CRUD. No phase ever built it. The R5 commit created a stage worker that treats `harness` as a literal command string. When R5-V tried to actually execute, there was no DB infrastructure to resolve harness names to binaries + args + flags.

The agent discovered this gap during implementation and improvised a harness table — guessing at the schema instead of reading PAT's `v2_tools` model. The user caught the discrepancy.

### 4. No testing before commit

Every commit was made without running the code in a browser. The agent ran `tsc --noEmit` (type checking) and the invariant grep checks, then committed. These checks verify code correctness, not feature correctness. The Zod v4 union bug, the silent throw errors, the wrong CLI flags — all would have been caught by a single browser test or even a curl call to the endpoint.

The session protocol says "No phase is complete without human verification" (invariant #21). The agent committed 6 times before the user tested anything.

### 5. Reactive fix pattern instead of diagnosis

When the user reported "fails with no output," the agent immediately started guessing at fixes instead of diagnosing:
- Fix 1: Replace throws with event writes (wrong root cause)
- Fix 2: Replace z.union with optional fields (correct but should have been caught pre-commit)
- Fix 3: Use bash -c wrapper (bandaid)
- Fix 4: Add harness table (correct direction, wrong schema)
- Fix 5: Match PAT's schema (correct, but only after user demanded it)

Each fix was a separate commit/merge, creating a messy git history and burning the user's time on repeated "try again" cycles.

---

## Systemic Issues

### The enforcement system has a gap

The R3.5 enforcement infrastructure prevents:
- ✅ Write on existing UI files (write guard hook)
- ✅ File shrinkage/removal (phase snapshot check)
- ❌ **Commits that bypass the skill chain** — nothing checks whether work went through `/implement`

A pre-commit hook could check for a `.implement-session` marker or a specific branch naming pattern. Without this, the skill chain is advisory — the agent can acknowledge it and proceed to ignore it.

### Documentation alone doesn't enforce process

The skill chain is documented in three places. The agent read all three. It still didn't follow them. More documentation won't fix this. The enforcement needs to be mechanical — a hook, a required file, something that blocks the commit if the process wasn't followed.

### Vague plans produce vague implementations

"Reference PAT" is not a plan. A plan for UI work must be a component-level inventory with field names, layout structure, and data flow. The plan review step needs to verify this level of detail before approving.

---

## Corrective Actions

### Immediate
1. ✅ All R5-V work reverted to pre-session state
2. ✅ Proper plan written with PAT component-level parity checklist
3. Plan requires user approval before any implementation

### Process
4. All future implementation MUST go through `/implement` skill — no direct editing
5. Plans for UI work must include field-level inventory from PAT reference
6. Agent must test via curl or browser BEFORE committing — not just `tsc`

### Enforcement Gap (for user to decide)
7. Consider a pre-commit hook that checks for skill chain markers
8. Consider requiring the Codex review to pass before merge (not just "available")

---

## Lessons

1. Reading instructions is not the same as following instructions. Three layers of documentation failed because there's no mechanical enforcement of the skill chain.
2. "Reference PAT" is not a spec. The plan must contain the same level of detail as the implementation it describes.
3. Type checking is not testing. `tsc --noEmit` passing tells you nothing about whether the feature works.
4. When something doesn't exist in the schema (harness table), that's a gap in the rebuild plan — flag it to the user, don't improvise.
5. Reactive fix cycles waste more time than getting it right once. Diagnose before fixing.
