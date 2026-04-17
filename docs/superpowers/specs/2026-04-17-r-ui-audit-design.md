# Multi-Team Audit of R-UI-1 + R-UI-2 — Design Spec

**Date:** 2026-04-17
**Status:** Approved (design; execution limited to Phase 1, gate 1)
**Author:** Joe Pierce + Claude
**Target surface:** R-UI-1 (merged, PR #31/#32/#33) and R-UI-2 (current branch `feat/r-ui-2-impl`, 11 commits ahead of main)

## Why This Exists

Working with agents across recent phases has produced observable drift:

- Agents wanting to defer work instead of completing it
- Hardcoded values sneaking in despite invariants 1–9
- Vendor-specific terms and tooling appearing where the engine is supposed to be agnostic
- Re-engineering of already-approved decisions
- Agents asking questions the docs already answer — evidence of skimming, not reading

This spec designs a multi-team audit to catch drift in the two most recent phases, gated to block the R-UI-2 merge until clean, with explicit escalation to a full-codebase sweep if the narrow pass reveals systemic rot.

This is the **design** for the full workflow. Only **Phase 1, gate 1** (the audit report) is in scope for immediate execution. Downstream remediation is documented here but executed in a later engagement.

## Related Documents

- **Source-of-truth authority:**
  - `docs/invariants.md` — 24 hard constraints (authoritative)
  - `docs/superpowers/specs/2026-04-07-fluxaos-spec-v2.md` — founding principles
  - `docs/superpowers/specs/2026-04-09-rebuild-spec.md` — rebuild invariants
  - `CLAUDE.md` — project commands and key principles
  - `docs/session-quick-start.md` — conventions
- **Phase specs being audited:**
  - `docs/superpowers/specs/2026-04-16-r-ui-1-design.md`
  - `docs/superpowers/plans/2026-04-16-r-ui-1-implementation.md`
  - `docs/superpowers/specs/2026-04-16-r-ui-2-design.md`
  - `docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md`
- **Stale document flagged for update:**
  - `ARCHITECTURAL_STANDARDS.md` — refers to Python/`flu install`/`fh-commons`/webapp patterns that no longer apply; principles (no hardcoding, fail fast, DRY, ≤500 lines, no mocks) still valid. The audit treats `docs/invariants.md` as authoritative and treats `ARCHITECTURAL_STANDARDS.md` as *supplementary principles only* — not as a source of concrete examples.

## Workflow Overview

Three artifacts, three gates, executed in order:

```
Gate 1: AUDIT.md (findings report)        ← THIS ENGAGEMENT
   ↓ user approval
Gate 2: REMEDIATION-PLAN.md                ← out of scope, fresh decision
   ↓ user approval
Gate 3: Executed remediation commits       ← out of scope, fresh decision
   ↓ user verification in running browser
R-UI-2 cleared for merge
```

**Only Gate 1 runs as part of this engagement.** Gates 2 and 3 are documented below so the workflow is reproducible in a later session, but they are explicitly not committed to now.

## Phase Structure

### Phase 1 — Narrow merge-gate audit (scope of this engagement)

Audits only R-UI-1 and R-UI-2 surfaces. Acts as a merge gate for R-UI-2.

### Phase 2 — Full-codebase sweep (conditional, not pre-committed)

Triggered only if Phase 1 meets the escalation threshold below. Same four lanes, same synthesis, same gate structure, applied to the rest of `src/`.

## Escalation Trigger (Phase 1 → Phase 2)

Phase 2 fires if **any** of these is true after Phase 1 synthesis:

1. Any invariant-1-through-9 violation found in **non-adapter, non-seed** code, OR
2. ≥3 findings at **High** severity across the audited surface, OR
3. Any Doc-Skim finding with evidence that an agent skipped or contradicted an already-settled decision in the specs/invariants/CLAUDE.md.

Trigger evaluated mechanically during synthesis. Escalation decision stated explicitly in the audit report.

## Scope

### In scope (Phase 1)

- **R-UI-1 surface**: all code merged via PR #31, #32, #33.
  - Identified by `git diff 62de54c..5cdcc1b -- src/` (R-INFRA merge baseline → last R-UI-1 commit on main).
- **R-UI-2 surface**: all commits on `feat/r-ui-2-impl` not yet on main.
  - Identified by `git diff main..HEAD -- src/` (currently 11 commits, `23a20eb` through `4345e3c`).
- **Every file those commits touched** — not just added lines. If a phase modified a pre-existing file, the whole file is in scope because the agent had responsibility for the file's current state.
- **The R-UI-1 and R-UI-2 spec and plan documents themselves** — needed by Plan Adherence and Doc-Skim lanes.

### Out of scope (Phase 1)

- All other code in `src/` (R1 through R-INFRA). If a specialist stumbles across something egregious in out-of-scope code, it logs a Phase 2 candidate and keeps going — no unilateral scope expansion.

## The Four Specialist Lanes

Four parallel subagents, each with one lens. No cross-lane reads. Each agent returns a findings list only.

### Lane 1: Invariants Auditor

**Lens:** `docs/invariants.md` (24 invariants) + V2 founding principles (no vendor coupling, everything is config, engine is generic).

**Mechanical checks (mandatory, output pasted verbatim):**

- Invariants 1–3: grep for hardcoded stage/provider/driver names in non-adapter, non-seed code
- Invariant 4: grep for hardcoded enums (`type IssueState`, `type IssuePriority`, etc.) in `src/core/`
- Invariant 7: grep for vendor imports in `src/core/` (`@supabase`, `bullmq`, `ioredis`, `@anthropic`, `openai`)
- Invariant 10: file-size check — any `.ts`/`.tsx` > 500 lines
- Invariant 15: any `*.test.ts` that does not touch Supabase/DATABASE_URL

**Judgment checks:**

- Invariant 8: are new services using DI or reaching for singletons?
- Invariant 9: fail-fast vs. silent defaults
- Invariant 11: DRY between new code and existing patterns
- Invariant 22: spec deviations that should have been flagged but weren't

**Deliverable format per finding:**

- Invariant # violated
- File:line
- Severity (High/Medium/Low)
- Evidence (quoted excerpt)

### Lane 2: Plan Adherence Auditor

**Lens:** R-UI-1 spec + plan vs. merged code. R-UI-2 spec + plan vs. current branch state.

**Checks:**

- Every task in each plan: done / partial / deferred. If deferred, was it flagged explicitly?
- Every requirement in each spec: met / partially met / missing
- Any work done that wasn't in the plan (scope creep)
- Re-litigation: code that contradicts an approved spec decision without prior discussion
- Any TODO / FIXME / placeholder left behind
- PR description vs. plan: did the PR body represent items as done that weren't?

**Deliverable:** One table per phase with columns — spec/plan item, implementation status, evidence, finding severity.

### Lane 3: Code Quality Auditor

**Lens:** DRY, dead code, over-engineering, premature abstraction, unnecessary indirection.

**Checks:**

- Duplicate or near-duplicate blocks (flag pairs ≥70% similar)
- Dead code: exported symbols with zero callers, files no longer imported
- Abstractions with one caller (interface/factory/wrapper used exactly once)
- Unused parameters, imports, component props
- Hardcoded magic strings/numbers that should come from config
- Vendor-specific terminology leaking into variable names, comments, or user-facing copy (e.g., `harnessName` after the R-UI-1 rename to `driver`)

**Deliverable format per finding:**

- File:line
- Category (DRY / dead / over-eng / hardcode / vendor-leak)
- Severity
- Direction (1 sentence on where the fix should head — not the fix itself)

### Lane 4: Doc-Skim Auditor

**Lens:** Did the agents actually read and apply the docs?

**Inputs:** Recent commits + PR bodies for R-UI-1 and R-UI-2; V2 spec; rebuild spec; invariants; session-quick-start; CLAUDE.md; the two phases' own specs.

**Checks:**

- Any commit or PR that makes a decision contradicting an explicit statement in these docs
- Any commit message / PR body that describes an approach conflicting with a settled decision
- TODOs/questions posed in commits that are already answered in the docs
- Re-implementations where an existing helper or pattern was available (evidence the agent didn't look)
- Renames or moves of doc-referenced concepts without updating the docs

**Deliverable format per finding:**

- Commit SHA or file:line
- Doc that was skipped
- Contradicting quote (commit vs. doc)
- Severity

### Cross-lane rules

- **Evidence required.** Every finding cites a file:line or commit SHA AND quotes an excerpt. Evidence-less findings are dropped in synthesis.
- **Single severity scale:** High (violates a non-negotiable principle or invariant 1–9), Medium (violates a secondary standard or accumulates drift risk), Low (stylistic / tidy-up).
- **No recommendations beyond "direction."** Concrete fixes are deferred to the remediation plan (gate 2).
- **Specialists do not read each other's output.** They run in parallel, independently. I deduplicate in synthesis.

## Subagent Prompt Template (applied to all four lanes)

Each specialist prompt contains, in order:

1. **Role & scope** — one specific lane, no license to wander
2. **Inputs** — explicit list of files/commits, absolute paths, no "explore the codebase"
3. **Required reading with gate** — list of docs the agent must read before analyzing; agent must quote a specific sentence from each required doc in its output (mechanical anti-skim check)
4. **Mechanical checks** — exact commands to run; output pasted verbatim into findings
5. **Judgment checks** — with explicit criteria for what counts as a finding
6. **Deliverable format** — strict template; evidence-less findings are invalid and must be dropped
7. **Hard don'ts** — no fixes, no reading other specialists' output, no scope expansion, no self-certifying commentary, no "this is probably fine" language
8. **Escape valve** — on a genuine blocker (missing file, spec ambiguity), return a structured "blocked" response naming the blocker; do not invent a finding or a workaround

Exact prompt text is drafted as part of the implementation plan, not this design doc.

## Anti-Drift Mechanics

The specialist subagents must not exhibit the behaviors they are auditing for. Mechanical counters, mapped to each failure mode:

| Failure mode | Counter in the subagent prompt |
|---|---|
| Skim the docs | Must quote a specific sentence from each required doc in output. If the quote is absent, synthesis treats the lane's output as untrusted. |
| Get lazy, defer findings | Prompt bans language like "this is probably fine" or "deferring this." Either evidence-backed finding, or silence. |
| Re-engineer a settled decision | Prompt includes an "already decided, do not relitigate" list pulled from specs. "This design seems wrong" commentary outside that list is flagged during synthesis. |
| Hardcode answers without looking | Mechanical greps are mandatory, output pasted verbatim. Synthesis re-runs the greps as a sanity check. |
| Hallucinate findings | Every finding cites file:line + quoted excerpt. Synthesis spot-checks 3 random findings per lane against the actual files. |
| Self-certify completion | Specialists never declare "all checks passed." They return their findings list, possibly empty. Synthesis decides pass/fail. |

### Synthesis-side counters

- **Spot-check up to 3 random findings per lane** (or all of them, if the lane returned fewer than 3) by opening the cited evidence. If quotes don't match, the lane's output is downgraded to "needs rerun."
- **Re-run mechanical grep outputs** independently. Disagreement → rerun the lane.
- **Flag any lane that returns zero findings** as suspicious. Manual pass before trusting it. Zero findings usually means the agent didn't look.

## Synthesis Process

After the four specialists return:

1. **Collect** — gather all four findings lists verbatim.
2. **Deduplicate** — findings surfaced by multiple lanes are merged, with all lanes credited.
3. **Cross-reference** — single root causes that produce findings in multiple lanes are grouped as "one finding, multiple symptoms" so remediation can fix root causes.
4. **Re-verify severity** — re-read evidence for every High finding and confirm.
5. **Check the escalation trigger** — run the three escalation conditions explicitly.
6. **Write the report.**

## Audit Report

**Location:** `docs/superpowers/audits/2026-04-17-r-ui-1-r-ui-2-audit.md`
(Creates the `docs/superpowers/audits/` directory as a new convention.)

**Structure:**

1. **Executive Summary** — 1 paragraph. Escalation pass/fail. Total findings by severity. Top 3 patterns observed.
2. **Escalation Decision** — explicit: "Phase 2 triggered: yes/no. Reason: …"
3. **Findings** — one section per finding (not per lane). Each finding:
   - ID (`AUDIT-001`, `AUDIT-002`, …)
   - Severity
   - Title
   - Lane(s) that surfaced it
   - Evidence (file:line / commit SHA + quoted excerpt)
   - Which invariant/standard/doc was violated
   - Impact (1 sentence)
   - Direction (1 sentence — not the fix itself)
4. **Patterns** — short subsections naming root-cause patterns when multiple findings share one. High-value section for preventing future drift.
5. **What I Can't Audit** — explicit list of items flagged by specialists as needing human judgment: subjective design choices, ambiguous-spec areas, decisions outside my authority.
6. **Appendix: Raw specialist outputs** — four findings lists verbatim, for traceability.

## Gate 1 (this engagement's stopping point)

1. Audit report committed.
2. Summary presented.
3. User reviews the committed file.
4. User approves the report or requests edits.
5. **Stop.**

No remediation work begins from this engagement. A fresh decision after gate 1 determines whether to proceed to gate 2.

## Handling the "no findings" case

If the audit finds nothing High and escalation doesn't trigger, the report is still committed (documenting Mediums/Lows). R-UI-2 is cleared for merge pending user approval. The remediation plan step is skipped entirely.

---

## Downstream Workflow (documented, out of scope for this engagement)

The sections below describe the full workflow for reference. They do **not** execute as part of this engagement. A separate decision — made after the audit report is committed and reviewed — determines whether to proceed.

### Gate 2: Remediation plan (downstream)

**Trigger:** Audit report approved AND at least one High or Medium finding exists. If only Lows, skip entirely and document Lows in `deferred-fixes.md`.

**Process:**

1. Invoke `superpowers:writing-plans` skill with the audit report as input.
2. Plan groups findings by **root cause**, not severity.
3. Plan sequences tasks by dependency.
4. Each task lists which findings it resolves (`resolves AUDIT-001, AUDIT-004, AUDIT-007`).
5. Plan saved to `docs/superpowers/plans/YYYY-MM-DD-r-ui-audit-remediation-plan.md` and committed.
6. Plan references the audit report by path — the two artifacts stay linked.

User reviews and approves the plan. No code touched until approval.

### Gate 3: Execution (downstream)

**Trigger:** Remediation plan approved.

**Process:**

1. Execute via `superpowers:subagent-driven-development`. Independent tasks parallelize; dependent ones serialize.
2. Atomic commits — one task, one commit, commit message references `AUDIT-XXX` IDs resolved.
3. After each task, the executing agent re-runs Lane 1's mechanical checks to verify no new violations.
4. **No self-certification** per invariant 21 — user verifies in a running browser or via command output.
5. When all tasks done and user-verified, the branch is ready for merge.

### Phase 2 remediation (downstream)

If escalation fired, Phase 2 runs identical workflow (same 4 lanes, same synthesis, same gates) against the rest of `src/`. Phase 2 remediation is a **separate** plan file: `...phase-2-remediation-plan.md`. Phase 1 fixes merge first; Phase 2 runs against the now-clean Phase 1 code.

### Scope escape during execution (downstream)

If a subagent finds new drift during execution that wasn't in the audit, it stops and files a finding into the audit report (as `AUDIT-NEW-001`), then the remediation plan is updated. No silent "while I'm here" fixes.

### Non-goals during remediation (downstream)

- No feature work. Only code changes that resolve audit findings.
- No "improvements" outside the plan. Tidy-up items go to `deferred-fixes.md`.
- No refactoring beyond what a finding explicitly requires.

These rules are restated in the remediation plan itself so executing subagents see them directly.

---

## Open items the audit cannot resolve

- **`ARCHITECTURAL_STANDARDS.md` is stale.** It references Python/`flu install`/`fh-commons`/webapp patterns that no longer apply. The audit treats the principles (no hardcoding, fail fast, DRY, ≤500 lines, no mocks) as still valid but explicitly de-authorities the stale examples. A separate engagement should rewrite or retire this document. Not part of this audit.
- **Subjective design choices** in the two phases — where the spec was ambiguous and the agent made a defensible call — are surfaced by specialists in the "What I Can't Audit" section of the report but are not treated as findings.
