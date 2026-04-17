# Session Handoff — Multi-Team Audit, Triage, Wave 1 Plan, and PR Merge

**Date:** 2026-04-17
**Session duration:** ~3.5 hours
**Session type:** Strategic / code-review (no application code changes)
**Branch worked on this session:** `docs/2026-04-17-audit` (forked from `main`, merged back via PR)
**Supersedes:** `2026-04-17-audit-triage-and-wave-1-plan.md` (earlier short handoff — retained for history but this is the authoritative session record)

---

## Executive Summary

The session began with the user flagging repeated drift in recent agent work: deferrals, hardcoded values, vendor coupling, agents re-litigating settled decisions, agents skimming docs. The session produced a **multi-team audit framework, executed it in two phases across 111 files, user-triaged the 111 findings, wrote a remediation plan for the foundation layer, and merged all of it to main as docs-only changes.** No application code was touched. The follow-on remediation work is scoped across four waves documented in the roadmap.

**What shipped to main:**
- 1 audit design spec (317 lines)
- 1 audit implementation plan (759 lines)
- 2 audit reports (Phase 1 + Phase 2 — ~3,035 lines including raw specialist outputs)
- 1 triage synthesis doc (authoritative — supersedes individual finding severities)
- 1 Wave 1 remediation plan (~830 lines)
- 1 handoff doc + roadmap update
- **Total: 29 new/modified docs, zero source code changes**

---

## Session Timeline

1. **User brainstorms audit scope** — flags four concerns: agents getting lazy/deferring, hardcoded values, vendor-specific terms in agnostic engine, agents asking questions the docs already answer
2. **Brainstorming skill** — user walked through 5 sections (scope, lanes, synthesis, remediation flow, anti-drift mechanics)
3. **Audit design spec committed** — two-phase structure (narrow R-UI-1+R-UI-2 first, escalate to full-codebase on threshold), 4 specialist lanes, evidence-mandatory findings, required-reading gates
4. **Audit plan written** — 8 tasks, shared prompt kernel with 7 absolute rules, per-lane mechanical + judgment checks
5. **Phase 1 executed** — 4 parallel specialists audited R-UI-1 (43 files, merged PRs #31/#32/#33) + R-UI-2 (13 files on `feat/r-ui-2-impl`)
6. **Phase 1 synthesis** — 28 findings (8H / 14M / 9L); all three escalation conditions fired
7. **Phase 2 executed** — 10 parallel specialists (Lanes 1 & 3 split by area, Lane 2 full surface, Lane 4 historical) swept 96 files
8. **Phase 2 synthesis** — 80 findings (27H / 30M / 23L); combined 111
9. **Pattern-by-pattern user triage** — 6 patterns + 2 D-forks, user-led decisions
10. **Wave 1 plan written** — 9 tasks, foundation-layer only, ~830 lines
11. **Short handoff + roadmap drafted** on `feat/r-ui-2-impl` branch
12. **Branch strategy reviewed** — flagged that `feat/r-ui-2-impl` carried paused R-UI-2 implementation underneath the 5 audit commits; merging as-is would ship partial code. User chose Option A (clean docs-only PR).
13. **New branch** `docs/2026-04-17-audit` created from main; 5 audit commits cherry-picked cleanly (28 files, zero source changes)
14. **Roadmap fully updated** — R-UI-2 reclassified to Paused (partial), R-AUDIT added as Done, R-REM-W1 through W4 inserted, R-AUDIT Results section added, 4 new lessons (9-12)
15. **PR opened, reviewed, merged to main** — session close

---

## Audit Framework (durable pattern — reusable for future audits)

**Four specialist lanes:**
1. **Invariants auditor** — mechanical greps for hardcoded stage/provider/driver names, vendor imports in core, file-size > 500 lines, unit-test files. Plus judgment checks on DI, fail-fast, DRY, deviation flagging.
2. **Plan adherence auditor** — compares shipped code against the phase's spec/plan/PR body. Classifies each task as Done/Partial/Deferred-flagged/Deferred-silent/Missing/Scope-creep/Re-litigated.
3. **Code quality auditor** — DRY/dead/over-engineering/indirection/unused/naming/vendor-leak/magic-value lens.
4. **Doc-skim auditor** — did the agent read the docs? Looks for contradicts-invariant, asks-answered-question, reinvents-helper, relitigates-decision, rename-without-doc-update, undocumented-deviation.

**Anti-drift mechanics (why this audit caught more than prior code reviews):**
- **Required-reading gate**: every specialist must quote one substantive verbatim sentence from each of 5 authoritative docs before producing findings. Missing/fabricated quotes invalidate the lane.
- **Evidence-mandatory**: every finding cites file:line or commit SHA + a quoted excerpt. Evidence-less findings are dropped in synthesis.
- **No self-certification / no deferral language**: specialists banned from writing "this looks fine" or "probably fine" — either evidence-backed finding or silence.
- **Already-decided list**: explicit list of settled decisions specialists must not re-litigate.
- **No scope expansion**: out-of-scope findings go to "Phase 2 candidates" section, not Phase 1 findings.
- **Synthesis verification**: orchestrator (me) re-runs mechanical checks independently, spot-checks 3 findings per lane by opening cited files.

**Escalation trigger (Phase 1 → Phase 2):** any ONE of: (a) invariant-1-9 violation in non-adapter/non-seed code, (b) ≥3 High-severity findings, (c) any doc-skim evidence that an agent contradicted a settled decision. All three fired in Phase 1.

**Phase 2 topology:** 10 specialists total. Lanes 1 + 3 each split by area (core / server+app+components / adapters+lib+config / tests). Lanes 2 + 4 stayed single-agent (spec-compliance and doc-skim both needed full-surface views).

---

## 111 Audit Findings — Aggregate View

| Severity | Phase 1 | Phase 2 | Combined |
|---|---|---|---|
| High | 8 | 27 | 35 |
| Medium | 14 | 30 | 44 |
| Low | 9 | 23 | 32 |
| **Total** | **28** | **80** | **111** |

**Six patterns emerged:**

1. **Adapter registry decorative for 5 of 10 ports** — only database/queue/executor truly route through `registry.get<T>()`; auth bypassed, realtime unregistered, 4 ports unimplemented
2. **Half of alpha "Must Have" scope missing** — no CLI, no GitHub adapter, no AIProvider adapters, half the Settings tabs, no Mission Control, Just Do It backend stubbed
3. **Optimistic concurrency applied inconsistently** — skills correct, everything else (driver.delete, issue.updateStatus, persona/provider/organization/project routers, pipeline runtime tables) missing
4. **No real CRUD factory despite invariant 11 mandating one** — stub exists using `as any`, not versioned; routers hand-roll; `issue-catalog.ts` re-invents
5. **Dead code across 12+ files** — `pipeline/types.ts`, type-only modules, unimplemented ports, unused exports, dead tRPC procedures
6. **Invariant 7 text vs verification script disagree on drizzle-orm** — prose bans runtime imports, script doesn't scan; 100+ live imports in ambiguous state

---

## Triage Decisions (authoritative — supersede individual finding severities)

See `docs/superpowers/audits/2026-04-17-audit-triage.md` for full detail.

### Pattern 1: B (split)
- **Real drift, fix in Wave 2:** auth, realtime registry-bypass
- **Unbuilt features:** ai, git, issue — build in Wave 3; notification, storage — deleted in Wave 1 (dead ports)

### Pattern 2: C (case-by-case) + C1 (build minimal CLI)
**Defer post-alpha:**
- Just Do It mode
- OpenAI adapter (Anthropic is sole alpha AI provider)
- Brand service

**Build for alpha (Wave 3):**
- CLI (thin tRPC-client wrapper — 1-2 days per user's insight: "single API, non-interactive commands share the API")
- GitHub adapter + git/issue port implementations
- Anthropic adapter (AIProvider)
- 6 Settings tabs (Cron Jobs, Teams, Users, System, Stages, Projects)
- Mission Control page

### Pattern 3: A (fix everywhere)
Every mutable entity gets version columns + version-locked mutations. No exemptions for pipeline runtime tables. CRUD factory gets versioned variant in Wave 1.

### Pattern 4: A (build properly, migrate all)
Wave 1 builds the CRUD factory (versioned, type-safe, no `as any`). Wave 2 migrates organization/project/provider/persona/skill/driver/issue-catalog onto it.

### Pattern 5: C (delete everything not in scope) + C1 (drop dead schema tables)
Dead source files deleted AND dead schema tables dropped (`issue_attachment`, `issue_dependency`, `issue_saved_view`). Demo files + db scripts relocated out of `src/core/` to `src/scripts/`.

### Pattern 6: B (pragmatic — amend invariant 7 prose)
User's framing: "Drizzle is a core app (like TypeScript, fastAPI, etc.)... we just need to be as modular config/adapter driven as possible" — pluggable integrations (systems you connect to like ServiceNow) need adapters; core stack (Drizzle, TypeScript, Next.js, tRPC) does not. Invariant 7 text + verification script both need updating to reflect this two-category distinction.

### D-fork 1: Retire ARCHITECTURAL_STANDARDS.md
Stale Python/fh-commons/webapp doc; all still-valid principles already covered by `docs/invariants.md`. Delete file, fix cross-references.

### D-fork 2: Accept Drizzle-typed `Database` as documented infrastructure
Add comment in `ports/database.ts` explaining the intentional type alias. No code change.

---

## Four-Wave Remediation Roadmap

### Wave 1 — Foundation (PLAN READY)

**Location:** `docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md`
**Size:** 9 tasks, ~830 lines
**User-facing impact:** Zero
**Dependencies:** None — can execute immediately

Tasks:
1. Amend invariant 7 prose + verification script
2. Retire ARCHITECTURAL_STANDARDS.md
3. Add intentional-typing comment to `ports/database.ts`
4. Rewrite CRUD factory (versioned + type-safe, with integration tests)
5. Delete unused exports (OUTPUT_FORMAT, isRule, registry.has(), trend prop, triggerRun)
6. Delete dead source files (Brand service, 3 issue-feature services, type-only modules, 2 unused ports, orchestrator barrel, stage-worker)
7. Drop dead schema tables via migration 0006 + remove dead tRPC procedures
8. Relocate out-of-core files to `src/scripts/`
9. End-to-end verification (includes mandatory user browser check per invariant 21)

**Execute via:** `superpowers:subagent-driven-development` or `superpowers:executing-plans`

### Wave 2 — Architecture Remediation (SCOPED, NOT PLANNED)

**Depends on:** Wave 1 must land first
**User-facing impact:** Zero (internal refactor)

Scope:
- Migrate existing entities onto CRUD factory: organization, project, provider, persona, skill, driver, issue-catalog
- Add version columns + version-locked mutations to all mutable entities missing them
- Wrap `issue-comment.ts` soft-delete in transaction
- Route auth through `AuthProvider` port — delete `@supabase/ssr` duplicates from `lib/supabase/`; collapse into `adapters/supabase/` per spec v2 Containment Rule
- Register `realtime` in adapter registry; route `lib/realtime/context.tsx` through `registry.get<RealtimeProvider>`
- Relocate Anthropic Messages JSON-protocol parsing out of `core/orchestrator/output-parser.ts` into an adapter (Phase 1 AUDIT-013)

### Wave 3 — Alpha-Critical Build (SCOPED, NOT PLANNED)

**Depends on:** Wave 1 (CRUD factory) + Wave 2 (registry routing)
**User-facing impact:** Substantial — new features and tabs land

Scope:
- CLI (`src/cli/`): thin tRPC-client wrapper, 4-5 non-interactive commands (`issue list/create/view`, `status`, `run`, `config get/set`)
- GitHub adapter (`src/adapters/github/`): GitProvider + IssueProvider implementations
- Anthropic adapter (`src/adapters/anthropic/`): AIProvider
- 6 Settings tabs using the new CRUD factory: Cron Jobs, Teams, Users, System, Stages, Projects
- Mission Control page (reads existing orchestrator state — new UI, no new backend)

### Wave 4 — Cleanup + Polish (SCOPED, NOT PLANNED)

**Depends on:** Waves 1-3
Scope:
- Remaining Low-severity findings not addressed earlier
- Spec + roadmap reconciliation
- Re-run targeted audit to confirm no regressions
- Full-journey browser verification (rebuild-spec §Full Journey Test 58-item checklist)

---

## R-UI-2 Status (separate concern, paused mid-phase)

The R-UI-2 implementation branch `feat/r-ui-2-impl` is **still paused after task 11** per the earlier handoff at `docs/superpowers/handoffs/2026-04-17-r-ui-2-implementation-session-a-paused.md`. The audit confirmed several issues with what's already landed on that branch:

- **AUDIT-003**: `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` is 880 lines (was 1019 at pause time); Task 12 cannot proceed without addressing invariant 10
- **AUDIT-005**: RunDetailModal uses Realtime subscription AND 2-second polling simultaneously; contradicts R-UI-2 spec's "no fallbacks" principle
- **AUDIT-010**: `event-orchestrator.ts` constructor still lacks `queue: QueueProvider` per R-UI-2 spec; `recoverOnStartup` unchanged
- **AUDIT-012**: Issue activity-feed Realtime subscription promised in spec but file is untouched
- **AUDIT-016**: R-UI-2 plan File Map points to root layout; spec + shipped code use project-scoped layout — plan has stale instruction

The R-UI-2 branch should not merge until Wave 2 remediation addresses the overlapping concerns. The cleanest path is: land Wave 1, land Wave 2 (which naturally fixes AUDIT-005 and -010 as part of auth/realtime/orchestrator work), then resume R-UI-2 tasks 12-32 against the clean substrate. Alternatively, the R-UI-2 branch could be formally abandoned if it's judged easier to re-plan tasks 12-32 on top of remediated code.

---

## Tests / Verification This Session

**Audit-specific verification (synthesis anti-drift passes):**
- ✅ Required-reading gate: all 10 Phase 2 specialists produced 5 verbatim quotes each; spot-checked 8 quotes against the actual docs — all matched
- ✅ Mechanical-check re-run: independently re-ran specialist greps for stage names, vendor imports in core, harness leakage, file sizes — outputs matched
- ✅ Hallucination spot-checks: opened cited evidence for ~8 High findings across the two phases — every quoted excerpt verified at cited line
- ✅ Zero-finding lane flag: none returned zero, so no manual backstop pass needed
- ✅ Severity re-verification: re-read evidence for every High; 3 findings escalated Medium→High during synthesis, none demoted

**Docs-only PR verification (this is docs-only, so no app tests applicable):**
- ✅ Cherry-picks clean (5 commits applied without conflict; `git diff main -- src/` returned 0 lines — no source changes leaked)
- ✅ Pre-commit hook passed on roadmap commit
- ✅ File count matches expectation: 29 new/modified docs files, 0 modified source files
- ✅ All cross-reference links within the new docs resolve to files that exist (audit reports link to each other + raw files; triage links to both reports; Wave 1 plan links to triage; handoff links to all)

**What was explicitly NOT verified this session:**
- Application build / type-check / test suite (no source changes; nothing to verify)
- Browser / Playwright / UI flows (no UI changes)
- Dev server startup (no config changes)
- Database / migrations (no schema changes)
- The audit *findings themselves* — they are claims; the Wave 1+ remediation is what actually fixes code. The audit's verification discipline gave confidence that findings are evidence-backed, but whether each finding merits the fix is a triage decision (captured in `audit-triage.md`)

**Verification deferred to Wave 1 execution:**
- Invariant 7 amended text + verification script agree
- CRUD factory integration tests (5 new test cases)
- Nuke + seed + verify end-to-end cycle after dead-code / schema purge
- Browser verification per invariant 21 (Wave 1 Task 9 Step 7)

---

## Commits Shipped to Main (this session's PR)

On docs branch `docs/2026-04-17-audit`, which cherry-picked 5 commits from `feat/r-ui-2-impl` (preserving SHAs' ancestry via author/date) and added 1 roadmap commit:

```
fe88497 docs(roadmap): record R-AUDIT results + insert R-REM-W1 through W4 phases
50a7945 docs: audit triage + Wave 1 remediation plan + handoff
2b2c120 docs: Phase 2 full-codebase audit report
b17fe69 docs: R-UI-1 + R-UI-2 audit report — Phase 1 gate 1
07c0de5 docs: implementation plan for R-UI audit Phase 1 gate 1
12948b3 docs: design spec for R-UI-1 + R-UI-2 multi-team audit
```

Total: **6 commits, 29 files, ~5,500 lines of docs, 0 source code changes.**

---

## Current Repo State (end of session)

- **main:** contains merged audit docs (PR to be filed below)
- **`feat/r-ui-2-impl`:** retained — still carries 11 commits of paused R-UI-2 implementation + 5 audit commits (now redundant with main — but safe to leave; resolves naturally when the branch is either resumed and merged, or abandoned)
- **`codex/add-pat-issue-detail-mockup`:** merged to main earlier (PR #35); local branch can be pruned
- **Worktree:** single worktree at `/mnt/dev/fluxaos`; nothing to clean up

---

## Next Session — Three Options

Pick ONE based on energy and available context:

### Option A — Execute Wave 1 (RECOMMENDED)

Foundation remediation. 9 tasks, zero user-facing impact, atomic commits per task, takes ~2-3 sessions to finish properly. Clears the substrate for Wave 2.

**Start prompt snippet:**
> "Execute `docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md` using `superpowers:subagent-driven-development`. Branch: create `feat/wave-1-foundation` off main. Commit per task."

### Option B — Plan Wave 2 before executing Wave 1

Writes the next plan document so waves are fully scoped before any execution. Longer-ceremony path.

**Start prompt snippet:**
> "Write the Wave 2 architecture-remediation plan. Triage decisions are in `docs/superpowers/audits/2026-04-17-audit-triage.md`. Scope: CRUD factory migration, optimistic concurrency backfill, auth/realtime registry routing, Anthropic-protocol extraction. Depends on Wave 1."

### Option C — Resume or abandon R-UI-2 first

The R-UI-2 branch is still paused with known issues. Before doing any remediation, decide whether to resume tasks 12-32 against the current (pre-remediation) substrate, or to formally abandon and re-plan against post-remediation code.

**Start prompt snippet:**
> "R-UI-2 decision session. Branch `feat/r-ui-2-impl` has paused implementation with 5 audit findings against the already-landed code. Decide: (a) resume tasks 12-32 now, accepting the findings as deferred; (b) abandon and re-plan R-UI-2 after Wave 2; (c) partial resume — finish only the unblocked tasks."

**My recommendation:** Option A. Wave 1 is the smallest-surface, highest-leverage work, clears the decks, and its commits are small enough to review between tasks. After Wave 1 lands, Option C becomes easier (remediated substrate to replan against) and Wave 2's dependencies are sharper.

---

## Reference Documents

All paths relative to repo root:

- Audit design: `docs/superpowers/specs/2026-04-17-r-ui-audit-design.md`
- Audit implementation plan: `docs/superpowers/plans/2026-04-17-r-ui-audit-plan.md`
- Phase 1 audit report: `docs/superpowers/audits/2026-04-17-r-ui-1-r-ui-2-audit.md`
- Phase 2 audit report: `docs/superpowers/audits/2026-04-17-phase2-full-codebase-audit.md`
- **Triage synthesis (authoritative):** `docs/superpowers/audits/2026-04-17-audit-triage.md`
- Wave 1 plan: `docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md`
- Raw Phase 1 outputs: `docs/superpowers/audits/.raw/`
- Raw Phase 2 outputs: `docs/superpowers/audits/.raw-phase2/`
- Earlier short handoff (superseded by this doc): `docs/superpowers/handoffs/2026-04-17-audit-triage-and-wave-1-plan.md`
- R-UI-2 pause handoff (separate concern): `docs/superpowers/handoffs/2026-04-17-r-ui-2-implementation-session-a-paused.md`
- Roadmap: `docs/superpowers/roadmap.md`

---

## Session Conventions Applied (for future-audit auditors)

- **Brainstorming skill used at session start** — produced the audit design before any execution
- **Writing-plans skill used** — produced the audit implementation plan (Phase 1 gate 1) and Wave 1 plan
- **Subagent-driven-development bypassed by design** — the audit plan's implementers ARE specialist subagents; layering another pass would have added indirection without value
- **Three-gate discipline (Approach 1)** — audit → remediation plan → execution; only gate 1 + planning-for-gate-2 shipped this session; gate 2+ execution explicitly deferred
- **Quality over speed** (saved as memory) — user consistently picks thorough options; applied throughout triage (Pattern 3: A, Pattern 4: A, Pattern 5: C)
- **Edit-never-Write** — every doc in this session is a Write (all new files). No existing source files modified.
- **No self-certification** — this handoff explicitly documents what was NOT verified (application tests, browser, build); Wave 1's exit criteria include user browser verification per invariant 21
