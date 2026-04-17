# R-UI-1 + R-UI-2 Audit — Phase 1 Gate 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a committed audit report (`docs/superpowers/audits/2026-04-17-r-ui-1-r-ui-2-audit.md`) from four parallel specialist subagents, with anti-drift counters applied during synthesis. No code changes, no remediation — report only.

**Architecture:** Four parallel specialist subagents (Invariants, Plan Adherence, Code Quality, Doc-Skim) run against the R-UI-1 + R-UI-2 surface. Orchestrator synthesizes into a single report with escalation decision. Each subagent receives a strict prompt with required-reading gates, mechanical checks, evidence-mandatory deliverable format, and hard don'ts — the audit must not exhibit the behaviors it is auditing for.

**Tech Stack:** Claude Code `Agent` tool with `general-purpose` subagent_type, `Bash`/`Grep`/`Read` for mechanical checks, Git for commit-range diffs, GitHub `gh` CLI for PR body retrieval.

**Design spec:** `docs/superpowers/specs/2026-04-17-r-ui-audit-design.md`

**Scope boundary:** This plan covers Phase 1 gate 1 only — generating and committing the audit report. Gate 2 (remediation plan) and gate 3 (execution) are documented in the design but are out of scope for this plan. Escalation to Phase 2 (full-codebase sweep) is *decided* by this plan's synthesis step but *executed* in a separate engagement.

---

## File Structure

### New files created by this plan

| Path | Responsibility |
|------|----------------|
| `docs/superpowers/audits/2026-04-17-r-ui-1-r-ui-2-audit.md` | The committed audit report (single artifact, final deliverable) |
| `docs/superpowers/audits/.raw/lane-1-invariants.md` | Raw Lane 1 findings, verbatim from subagent |
| `docs/superpowers/audits/.raw/lane-2-plan-adherence.md` | Raw Lane 2 findings, verbatim from subagent |
| `docs/superpowers/audits/.raw/lane-3-code-quality.md` | Raw Lane 3 findings, verbatim from subagent |
| `docs/superpowers/audits/.raw/lane-4-doc-skim.md` | Raw Lane 4 findings, verbatim from subagent |

The `.raw/` subdirectory preserves each specialist's unedited output for traceability. The synthesized report references these files as the Appendix.

### No files modified

This plan does not modify any source file. It only reads source files (via specialists) and writes audit artifacts.

---

## Surface definitions (used by every specialist prompt)

### R-UI-1 surface (merged to main)

**Commit range:** `62de54c..5cdcc1b` (R-INFRA merge baseline → last R-UI-1 commit on main)

**PRs:** #31 (feat), #32 (fix), #33 (docs). PR #32 at the main level (`6d1c14e`) is the fix follow-up; note that an earlier R-INFRA commit also used "#32" in its message — we identify R-UI-1 PR #32 by the commit `6d1c14e` specifically.

**Files in scope:** 43 files (output of `git diff 62de54c..5cdcc1b --name-only -- src/`). Enumerated at plan execution time, not hardcoded here.

**Spec:** `docs/superpowers/specs/2026-04-16-r-ui-1-design.md`
**Plan:** `docs/superpowers/plans/2026-04-16-r-ui-1-implementation.md`

### R-UI-2 surface (branch `feat/r-ui-2-impl`, not yet merged)

**Commit range:** `main..HEAD` on the branch `feat/r-ui-2-impl`. Currently 13 commits (`23a20eb` → `ede55fa`), but `da987b3` (session handoff) and `ede55fa` (this audit's design commit) are docs-only. Subagents read the range and filter to code-bearing commits.

**Files in scope:** 13 source files (output of `git diff main..HEAD --name-only -- src/`).

**Spec:** `docs/superpowers/specs/2026-04-16-r-ui-2-design.md` (518 lines)
**Plan:** `docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md` (2412 lines — large; agents should read methodically, not skim)

**Session handoff:** `docs/superpowers/handoffs/2026-04-17-r-ui-2-implementation-session-a-paused.md` — documents that R-UI-2 is paused after task 11 of the plan, with tasks 12+ remaining. Lane 2 uses this to distinguish "not done" from "explicitly paused."

### Authoritative docs (all lanes read these)

1. `docs/invariants.md` — 24 invariants (authoritative)
2. `docs/superpowers/specs/2026-04-07-fluxaos-spec-v2.md` — founding principles
3. `docs/superpowers/specs/2026-04-09-rebuild-spec.md` — rebuild invariants
4. `CLAUDE.md` — project commands and key principles
5. `docs/session-quick-start.md` — conventions
6. `ARCHITECTURAL_STANDARDS.md` — principles-only; examples are stale (Python/fh-commons). Lanes are told explicitly to not cite stale examples from this file.

---

## Task 1: Prepare the audit workspace

**Files:**
- Create: `docs/superpowers/audits/` (directory)
- Create: `docs/superpowers/audits/.raw/` (directory)

- [ ] **Step 1: Verify we are on the right branch and the design doc is committed**

Run:
```bash
git branch --show-current
git log -1 --format='%H %s' -- docs/superpowers/specs/2026-04-17-r-ui-audit-design.md
```
Expected:
- Branch: `feat/r-ui-2-impl`
- Last commit touching the design doc is `ede55fa docs: design spec for R-UI-1 + R-UI-2 multi-team audit` (or a later amend/fixup)

If branch is different: STOP. The plan assumes `feat/r-ui-2-impl` is checked out.

- [ ] **Step 2: Create the audits directory and raw subdir**

Run:
```bash
mkdir -p docs/superpowers/audits/.raw
```

- [ ] **Step 3: Resolve the R-UI-1 and R-UI-2 file lists**

Run:
```bash
git diff 62de54c..5cdcc1b --name-only -- src/ > /tmp/r-ui-1-files.txt
git diff main..HEAD --name-only -- src/ > /tmp/r-ui-2-files.txt
wc -l /tmp/r-ui-1-files.txt /tmp/r-ui-2-files.txt
```
Expected: two numbers (approximately 43 and 13). These lists get passed verbatim into every specialist prompt. If either file is empty, STOP — something is wrong with the commit ranges.

- [ ] **Step 4: Snapshot the file lists so they can't drift mid-audit**

Run:
```bash
cp /tmp/r-ui-1-files.txt docs/superpowers/audits/.raw/r-ui-1-files.txt
cp /tmp/r-ui-2-files.txt docs/superpowers/audits/.raw/r-ui-2-files.txt
```

- [ ] **Step 5: Do not commit yet — these are intermediate artifacts**

The `.raw/` directory is committed *once* at the end of the synthesis step (Task 7), along with the final report. Empty-at-this-point dirs are fine; they'll be populated by Tasks 3-6.

---

## Task 2: Draft the shared "prompt kernel" used by all four specialists

The four specialist prompts share ~60% of their content (surface definitions, required reading, hard don'ts, deliverable format). We draft the shared kernel once, then each lane's prompt appends its lens-specific instructions.

**Files:**
- Create (in-memory, pasted into each Agent call): `prompt-kernel` string

- [ ] **Step 1: Define the shared prompt kernel**

The kernel is a string that every specialist prompt begins with. It contains exactly this content (use this verbatim — the anti-drift design depends on the specific wording):

```
You are a specialist auditor in a multi-team audit of fluxaOS code. You have been dispatched as ONE of four parallel lanes. You do not know, do not care, and must not read what the other three lanes produced.

# Absolute rules (non-negotiable)

1. **Evidence-mandatory.** Every finding MUST cite a file:line or commit SHA AND include a quoted excerpt of the offending code or text. A finding without evidence is invalid and must be dropped, not submitted.

2. **Required-reading gate.** Before you analyze anything, you MUST read these documents end-to-end (not skim):
   - /mnt/dev/fluxaos/docs/invariants.md
   - /mnt/dev/fluxaos/docs/superpowers/specs/2026-04-07-fluxaos-spec-v2.md
   - /mnt/dev/fluxaos/docs/superpowers/specs/2026-04-09-rebuild-spec.md
   - /mnt/dev/fluxaos/CLAUDE.md
   - /mnt/dev/fluxaos/docs/session-quick-start.md
   
   In your output's "Required-reading proof" section, quote ONE specific sentence (verbatim, in quotes) from EACH of the five docs above. Quotes must be substantive (not titles or table-of-contents lines). If you cannot produce a genuine quote from a doc, state that you did not read it. The synthesis step treats any missing or fabricated quote as cause to discard your lane's entire output.

3. **No recommendations beyond direction.** You may state where a fix should head in one sentence per finding. You must NOT propose concrete code, patches, or detailed remediation steps.

4. **No self-certification.** Do NOT write "all checks passed," "this looks fine," "no issues found in X," "overall the code is clean," or any equivalent language. Return findings only; an empty findings list is valid output, but absence of findings is NOT a positive claim.

5. **No deferral language.** Do NOT write "this is probably fine," "deferring this for later," "may warrant future review," or equivalents. Either a finding has evidence and you report it, or it doesn't and you say nothing.

6. **No scope expansion.** You MUST only analyze the files and commits listed in the "Surface" section below. If you believe something outside scope is relevant, note it ONCE in a separate "Phase 2 candidates" section — do not turn it into a Phase 1 finding.

7. **Blocker handling.** If you cannot proceed because an input file is missing, a spec is genuinely ambiguous, or a command fails, STOP and return a structured "Blocked" response. Do not guess, do not invent, do not work around.

# Already-decided (do not relitigate)

These decisions are settled. Findings that argue with these are drift on YOUR part, not on the code:

- Zero vendor imports in src/core/ (invariant 7) — this is non-negotiable
- No unit tests, ever (invariant 15) — integration tests against real Supabase only
- DI everywhere (invariant 8) — services are factory functions receiving Database
- Issue "harness" renamed to "driver" in R-UI-1 — this rename is settled; remaining "harness" references are findings, but "we should have kept harness" is not a finding
- Supabase Cloud is the dev database; nuke-and-seed freely
- Events tables are append-only (invariant 13)
- Optimistic concurrency via version fields on mutable entities (invariant 12)
- Fail fast on missing config; no silent defaults (invariant 9)

# Surface

R-UI-1 surface (merged to main):
- Commit range: 62de54c..5cdcc1b
- File list: see /mnt/dev/fluxaos/docs/superpowers/audits/.raw/r-ui-1-files.txt
- Spec: /mnt/dev/fluxaos/docs/superpowers/specs/2026-04-16-r-ui-1-design.md
- Plan: /mnt/dev/fluxaos/docs/superpowers/plans/2026-04-16-r-ui-1-implementation.md

R-UI-2 surface (branch feat/r-ui-2-impl, not yet merged):
- Commit range: main..HEAD (13 commits, of which da987b3 and ede55fa are docs-only)
- File list: see /mnt/dev/fluxaos/docs/superpowers/audits/.raw/r-ui-2-files.txt
- Spec: /mnt/dev/fluxaos/docs/superpowers/specs/2026-04-16-r-ui-2-design.md (518 lines)
- Plan: /mnt/dev/fluxaos/docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md (2412 lines — LARGE; read methodically, do not skim, the audit is specifically checking whether you read this)
- Session handoff: /mnt/dev/fluxaos/docs/superpowers/handoffs/2026-04-17-r-ui-2-implementation-session-a-paused.md — R-UI-2 paused after task 11; tasks 12+ are not "undone," they are explicitly paused

Plus: every file those commits touched is in-scope in full (not only modified lines).

Out of scope for Phase 1: all other files in src/. If you stumble across something egregious, list it in "Phase 2 candidates," not in findings.

# Severity scale (normalized across all lanes)

- **High:** Violates a non-negotiable principle or invariant 1-9 (agnosticism, vendor isolation, DI, config-driven, fail-fast, file-size, DRY, optimistic concurrency, append-only events)
- **Medium:** Violates a secondary standard or accumulates drift risk (plan adherence, code quality, doc-skim patterns)
- **Low:** Stylistic or tidy-up

# Deliverable format

Your entire output must be a single Markdown document with EXACTLY these sections in this order:

## Required-reading proof
- docs/invariants.md: "…verbatim quote…"
- docs/superpowers/specs/2026-04-07-fluxaos-spec-v2.md: "…verbatim quote…"
- docs/superpowers/specs/2026-04-09-rebuild-spec.md: "…verbatim quote…"
- CLAUDE.md: "…verbatim quote…"
- docs/session-quick-start.md: "…verbatim quote…"

## Mechanical-check output
[Paste verbatim stdout of every mechanical command the lens required. If a lens has no mechanical checks, write "N/A — this lane is judgment-only."]

## Findings
[One finding per subsection using the lens's deliverable format. If zero findings, write: "No findings under this lens. Note: this is a factual report of what I found, not a certification of correctness."]

## Phase 2 candidates (out-of-scope observations)
[Observations about code outside the R-UI-1 + R-UI-2 surface that might warrant a future audit. One line each, no recommendations.]

## Blocked (if applicable)
[Structured list of anything that stopped you: missing inputs, genuinely ambiguous specs, command failures. If none, omit this section.]

---

Your specific lens follows below.
```

- [ ] **Step 2: Verify the kernel is intact**

Read the kernel back and confirm:
- Seven absolute rules present
- Already-decided list present
- Surface definitions reference the snapshotted file lists
- Severity scale matches the design
- Deliverable format specifies exactly the five sections

No commit yet — the kernel lives in-memory and is pasted into each Agent dispatch in Tasks 3-6.

---

## Task 3: Dispatch Lane 1 — Invariants Auditor

**Files:**
- Read (by agent): R-UI-1 + R-UI-2 in-scope files, all authoritative docs
- Create: `docs/superpowers/audits/.raw/lane-1-invariants.md`

- [ ] **Step 1: Construct the Lane 1 prompt**

Take the prompt kernel from Task 2 and append the following lens:

```
# Your lens: Invariants

You are auditing the R-UI-1 and R-UI-2 surface for violations of /mnt/dev/fluxaos/docs/invariants.md and the founding principles in the V2 spec.

## Mechanical checks (mandatory — run ALL of them, paste output verbatim)

Run each command below. Paste its complete stdout into the "Mechanical-check output" section of your deliverable. Do not summarize, do not paraphrase, do not filter.

1. Hardcoded stage names (invariants 1) in non-adapter, non-seed, non-test code:
```
grep -rn '"research"\|"implement"\|"review"\|"deploy"\|"complete"\|"rework"' src/ \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=__tests__ --exclude-dir=adapters \
  | grep -v 'seed\|fixture\|\.test\.'
```

2. Hardcoded provider/driver names (invariants 2-3):
```
grep -rn '"anthropic"\|"openai"\|"claude"\|"gpt"\|"claude-code"\|"aider"\|"codex"' src/ \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=adapters \
  | grep -v 'seed\|fixture\|\.test\.'
```

3. Hardcoded issue-type enums (invariant 4):
```
grep -rn "type IssueState\|type IssuePriority\|type IssueType\|type PipelineStatus\|type StageStatus" src/core/ \
  --include='*.ts' | grep -v 'import\|\.test\.'
```

4. Vendor imports in core (invariant 7):
```
grep -rn "from '@supabase\|from 'bullmq\|from 'ioredis\|from '@anthropic\|from 'openai\|from 'drizzle-orm/postgres-js\|from 'execa" src/core/ \
  --include='*.ts' --include='*.tsx' | grep -v 'import type'
```

5. File size (invariant 10):
```
find src/ -name '*.ts' -o -name '*.tsx' | while read f; do
  lines=$(wc -l < "$f")
  [ "$lines" -gt 500 ] && echo "$f: $lines lines"
done
```

6. Unit tests (invariant 15) — any test file that does not touch Supabase:
```
find src/ -name '*.test.ts' -o -name '*.spec.ts' | while read f; do
  grep -L 'supabase\|DATABASE_URL\|integration' "$f" 2>/dev/null
done
```

## Judgment checks

Read each in-scope file and judge:
- **Invariant 8 (DI):** Are new services factory functions receiving Database, or are they singletons / direct imports of connections?
- **Invariant 9 (fail-fast):** Any silent defaults? Fallback chains? Missing-config handling that returns a default instead of throwing?
- **Invariant 11 (DRY):** Code in new files that duplicates an existing helper/pattern?
- **Invariant 22 (deviation flagging):** Any implementation choice that differs from the R-UI-1 or R-UI-2 spec without being flagged to the user in commit messages or PR bodies?
- **Invariant 24 (no undocumented removals):** Any UI, component, or feature that existed before and was silently removed or simplified?

## Finding format (use this exactly for each finding)

### AUDIT-INV-N: <one-line title>
- **Invariant:** #N (quoted text of the invariant)
- **Severity:** High | Medium | Low
- **File:line:** path:line
- **Evidence:** (quoted excerpt of the code or text)
- **Direction:** (1 sentence max)

## Scope reminder
Only R-UI-1 and R-UI-2 in-scope files. Everything else → "Phase 2 candidates" section.
```

- [ ] **Step 2: Dispatch the subagent (foreground, we need its output to proceed)**

Use the `Agent` tool with `subagent_type: "general-purpose"`, a short description `"Lane 1 invariants audit"`, and the full prompt (kernel + lens). Do not run in background — we need the output synchronously to write it to disk.

- [ ] **Step 3: Write the subagent's output verbatim to `.raw/lane-1-invariants.md`**

Do not edit, reformat, summarize, or filter the output. If the subagent returned a "Blocked" section, preserve it as-is. The raw file is the audit trail.

- [ ] **Step 4: Quick sanity check**

Verify the file contains all five required sections (Required-reading proof, Mechanical-check output, Findings, Phase 2 candidates, optionally Blocked). If any section is missing, this is a lane failure — mark the lane as "needs rerun" and re-dispatch in Step 2 with explicit reminder that all five sections are mandatory.

---

## Task 4: Dispatch Lane 2 — Plan Adherence Auditor

**Files:**
- Read (by agent): R-UI-1/R-UI-2 specs and plans, all in-scope code, PR bodies via `gh`, commit messages
- Create: `docs/superpowers/audits/.raw/lane-2-plan-adherence.md`

- [ ] **Step 1: Construct the Lane 2 prompt**

Take the prompt kernel from Task 2 and append the following lens:

```
# Your lens: Plan Adherence

You are auditing whether the R-UI-1 merge and the R-UI-2 in-flight branch actually implemented what their specs and plans said they would.

## Inputs (read these in full)

- R-UI-1 spec: /mnt/dev/fluxaos/docs/superpowers/specs/2026-04-16-r-ui-1-design.md
- R-UI-1 plan: /mnt/dev/fluxaos/docs/superpowers/plans/2026-04-16-r-ui-1-implementation.md
- R-UI-2 spec: /mnt/dev/fluxaos/docs/superpowers/specs/2026-04-16-r-ui-2-design.md
- R-UI-2 plan: /mnt/dev/fluxaos/docs/superpowers/plans/2026-04-16-r-ui-2-implementation.md (2412 lines — read in full)
- R-UI-2 handoff: /mnt/dev/fluxaos/docs/superpowers/handoffs/2026-04-17-r-ui-2-implementation-session-a-paused.md

## Retrieve PR bodies

Run `gh pr view 31 --json title,body,mergedAt` and `gh pr view 32 --json title,body,mergedAt` and `gh pr view 33 --json title,body,mergedAt` (R-UI-1 PRs).
Paste the `.body` field of each into the Mechanical-check output section.

R-UI-2 has no implementation PR yet — it is on the `feat/r-ui-2-impl` branch. Do NOT fetch PR #34 — that was the R-UI-2 planning merge (spec+plan only), not the implementation.

## Commit-message inspection

Run `git log --format='%H %s%n%b%n---' 62de54c..5cdcc1b -- src/` for R-UI-1 and `git log --format='%H %s%n%b%n---' main..HEAD -- src/` for R-UI-2. Paste both into Mechanical-check output.

## Checks

For each phase, build a table:
| Spec/plan item | Status | Evidence | Severity |

Status values:
- **Done** — implemented per spec, in the merged or branch code
- **Partial** — started but incomplete (the handoff's "paused" tasks count as Partial unless the handoff explicitly flagged the pause; re-classify to Deferred if so)
- **Deferred-flagged** — explicitly flagged in a commit, PR body, or handoff as deferred
- **Deferred-silent** — not done, not flagged (this is a Medium finding minimum)
- **Missing** — in the spec, not in the plan (this is a plan-quality finding)
- **Scope-creep** — in the code, not in the spec or plan (this is a Medium finding minimum)
- **Re-litigated** — the code made a different decision than the spec specified without discussion in commits/PR (this is a High finding if it contradicts an already-settled decision)

Additionally, check:
- Any TODO / FIXME / XXX / `// @ts-ignore` / `// eslint-disable` added in the two surfaces' commits that was not present before?
- Any PR body that described something as done that is not actually in the code?
- Any commit that says "defer X" without X being moved to `docs/superpowers/deferred-fixes.md`?

## Finding format

### AUDIT-PLAN-N: <one-line title>
- **Phase:** R-UI-1 | R-UI-2
- **Spec/plan reference:** (section heading or task number)
- **Status:** one of the values above
- **Severity:** High | Medium | Low
- **Evidence:** file:line AND/OR commit SHA AND/OR PR body quote
- **Direction:** (1 sentence max)
```

- [ ] **Step 2: Dispatch Lane 2 subagent**

Same pattern as Task 3, Step 2: `Agent` tool, `general-purpose`, foreground.

- [ ] **Step 3: Write output verbatim to `.raw/lane-2-plan-adherence.md`**

- [ ] **Step 4: Sanity check five required sections**

---

## Task 5: Dispatch Lane 3 — Code Quality Auditor

**Files:**
- Read (by agent): all R-UI-1 + R-UI-2 in-scope files
- Create: `docs/superpowers/audits/.raw/lane-3-code-quality.md`

- [ ] **Step 1: Construct the Lane 3 prompt**

Take the prompt kernel from Task 2 and append the following lens:

```
# Your lens: Code Quality

You are auditing the R-UI-1 + R-UI-2 in-scope files for DRY violations, dead code, over-engineering, premature abstraction, and vendor-term leakage.

## Mechanical checks

1. Unused exports (heuristic — high-signal but not definitive):
```
# List all exports from in-scope files
grep -rn '^export \(function\|const\|class\|interface\|type\)' $(cat docs/superpowers/audits/.raw/r-ui-1-files.txt docs/superpowers/audits/.raw/r-ui-2-files.txt) 2>/dev/null | head -200
```
Then spot-check any export whose name is unusual (not a common component/hook) by grepping for its usage across `src/`.

2. Vendor-term leakage — look for remaining "harness" references (should have been renamed to "driver" in R-UI-1):
```
grep -rn 'harness\|Harness' src/ --include='*.ts' --include='*.tsx' --exclude-dir=__tests__ | grep -v 'seed\|fixture'
```

3. Magic strings / numbers in new code:
```
# Look at added lines only in the two surfaces
git diff 62de54c..5cdcc1b -- src/ | grep -E '^\+' | grep -E '"[a-z]+"' | head -100
git diff main..HEAD -- src/ | grep -E '^\+' | grep -E '"[a-z]+"' | head -100
```
Judge each: is this a legit literal (React prop, enum value from DB) or a hardcoded config value that should be in the database?

## Judgment checks

For each in-scope file, judge:

- **Duplicate logic:** Is there a block ≥5 lines that appears in another in-scope file or in the rest of `src/` with ≥70% similarity?
- **Dead code:** An exported symbol whose only callers are within the same file (should it be exported?); a file no longer imported anywhere
- **Over-engineering:** An abstraction (interface/factory/wrapper) with exactly one concrete caller — is it justified by "we will add more" in the spec, or speculative?
- **Unnecessary indirection:** A function that just forwards to another function with no added logic
- **Unused code:** Unused function parameters, unused React props, unused imports the linter didn't catch
- **Inconsistent naming:** Same concept named differently in two new files
- **Vendor-specific terminology:** Not just "harness" — any Supabase/BullMQ/Drizzle/Anthropic/Claude-specific term leaking into `core/`, component names, or user-facing copy

## Finding format

### AUDIT-CQ-N: <one-line title>
- **Category:** DRY | dead | over-eng | indirection | unused | naming | vendor-leak | magic-value
- **Severity:** High | Medium | Low
- **File:line:** path:line (or multiple for DRY)
- **Evidence:** (quoted excerpt)
- **Direction:** (1 sentence max)

## What is NOT a finding under this lens
- Style preferences (tabs vs. spaces, prefer-const, named vs. default exports) — the project has lint rules for these
- "I would have structured this differently" — need concrete evidence of harm
- Test code quality (out of scope — tests have their own concerns)
```

- [ ] **Step 2: Dispatch Lane 3 subagent**

- [ ] **Step 3: Write output verbatim to `.raw/lane-3-code-quality.md`**

- [ ] **Step 4: Sanity check five required sections**

---

## Task 6: Dispatch Lane 4 — Doc-Skim Auditor

**Files:**
- Read (by agent): all commits and PR bodies for R-UI-1 and R-UI-2; all authoritative docs; the two phase specs
- Create: `docs/superpowers/audits/.raw/lane-4-doc-skim.md`

- [ ] **Step 1: Construct the Lane 4 prompt**

Take the prompt kernel from Task 2 and append the following lens:

```
# Your lens: Doc-Skim Detection

You are auditing whether the agents who produced the R-UI-1 merge and R-UI-2 branch actually READ the authoritative docs, or just skimmed them. This is the highest-signal lane for the drift pattern this audit is investigating.

## Inputs

All commits in both surfaces, their messages and bodies. All PR bodies (R-UI-1 PRs #31, #32 (6d1c14e), #33). The R-UI-2 handoff. The authoritative docs listed in the required-reading gate. The two phase specs.

## How "skimming" manifests

Look for these failure modes:

- **Contradicting a stated invariant:** A commit or PR introduces something that directly contradicts an explicit sentence in docs/invariants.md or either V2 or rebuild spec.
- **Asking a question the docs answer:** A commit message or PR body raises a question ("should we X?", "not sure if Y belongs here") that is already answered in the authoritative docs.
- **Re-inventing an existing helper:** The surface introduces a helper, component, or utility that already exists elsewhere in `src/` under a different name. (Cross-check with `grep -r` before concluding.)
- **Re-litigating a settled decision:** The code, commit messages, or PR bodies argue with a decision that is already marked settled (the "Already-decided" list in your prompt kernel, plus anything in the Related Documents of the two phase specs).
- **Renames without doc updates:** A concept was renamed in the code but the authoritative docs still reference the old name AND the rename was in-scope to update the docs (i.e., not a scope-escape).
- **Undocumented deviations:** Per invariant 22, deviations must be flagged to the user. A commit that deviates from the spec without any flag in its message or PR body is a skim-lane finding.

## Mechanical checks

1. Fetch every commit message and body for both surfaces:
```
git log --format='--- %H ---%n%s%n%n%b%n' 62de54c..5cdcc1b -- src/
git log --format='--- %H ---%n%s%n%n%b%n' main..HEAD -- src/
```
Paste both into Mechanical-check output.

2. PR body retrieval (R-UI-1 only; R-UI-2 has no implementation PR yet):
```
gh pr view 31 --json body
gh pr view 32 --json body
gh pr view 33 --json body
```
Paste all three bodies into Mechanical-check output.

## Finding format

### AUDIT-DOC-N: <one-line title>
- **Pattern:** contradicts-invariant | asks-answered-question | reinvents-helper | relitigates-decision | rename-without-doc-update | undocumented-deviation
- **Severity:** High | Medium | Low
- **Locus:** commit SHA or file:line
- **Doc that was skipped:** (path and the specific section/sentence)
- **Evidence:** two quotes side-by-side — the contradicting commit/code quote, AND the doc quote it contradicts
- **Direction:** (1 sentence max)

## Severity guidance for this lane
- **High:** Contradicts a non-negotiable invariant (1-9) or directly relitigates a decision the user marked settled
- **Medium:** Asks a question the docs answer, reinvents a helper, deviates without flagging
- **Low:** Naming drift, incomplete doc updates after a settled change
```

- [ ] **Step 2: Dispatch Lane 4 subagent**

- [ ] **Step 3: Write output verbatim to `.raw/lane-4-doc-skim.md`**

- [ ] **Step 4: Sanity check five required sections**

---

## Task 7: Synthesize findings and check escalation trigger

**Files:**
- Read: four `.raw/lane-*.md` files
- Create: `docs/superpowers/audits/2026-04-17-r-ui-1-r-ui-2-audit.md`

- [ ] **Step 1: Verify all four required-reading gates**

For each of the four raw files, open the "Required-reading proof" section. Confirm:
- All five quotes are present
- Each quote appears to be a substantive sentence (not a title, table heading, or obvious hallucination)
- For at least one quote per lane, open the referenced doc and verify the quote actually appears in the file

If any lane fails this gate: mark that lane's output as "needs rerun" and go back to the relevant Task 3/4/5/6 to re-dispatch.

- [ ] **Step 2: Verify mechanical-check output was pasted verbatim (Lanes 1, 3, 4)**

Re-run each lane's mechanical checks yourself:

```bash
# Lane 1 — all six commands from Task 3 Step 1
# Lane 3 — all three commands from Task 5 Step 1
# Lane 4 — all four commands from Task 6 Step 1
```

Compare your output to what each lane's raw file contains. Significant disagreement (commands reporting X files and the raw file reporting Y files for the same command) → mark that lane's output as "needs rerun."

Small formatting differences (trailing newlines, ANSI codes) are fine.

- [ ] **Step 3: Spot-check findings for hallucination**

From each lane's findings, pick up to 3 at random (or all if <3). For each:
- Open the cited `file:line`
- Confirm the quoted evidence actually appears at or near that line
- If the file doesn't exist, or the quote is invented: that lane is downgraded to "needs rerun"

- [ ] **Step 4: Flag any lane returning zero findings**

If a lane returned zero findings under its lens, do a manual pass of the in-scope files yourself, specifically looking for that lane's concerns. Zero findings is suspicious — it may be right, but it requires verification. Document your verification in the synthesis notes.

- [ ] **Step 5: Deduplicate and cross-reference**

For each finding from all four lanes:
- Does any other lane surface the same code location or same root cause? → merge into one finding with all surfacing lanes credited
- Does any group of findings share a root cause? → note it as a "pattern" for the Patterns section

- [ ] **Step 6: Re-verify severity on every High finding**

Re-open the evidence for each High. Confirm:
- The violated invariant or principle is one of the non-negotiables
- The evidence is not a false positive (e.g., a "claude" string that's in a comment explaining what NOT to do, a hardcoded name in a seed file, a vendor import in an adapter)

Demote if unwarranted. Note the demotion.

- [ ] **Step 7: Evaluate the escalation trigger**

Check each condition:
1. Any invariant-1-through-9 violation in non-adapter, non-seed code? (check Lane 1 findings)
2. ≥3 findings at High severity across all lanes (after dedup)?
3. Any Lane 4 finding with evidence an agent skipped or contradicted a settled decision?

If any is true → Phase 2 escalation fires. If all are false → no escalation.

Record the trigger evaluation explicitly in the report.

- [ ] **Step 8: Write the audit report**

Create `docs/superpowers/audits/2026-04-17-r-ui-1-r-ui-2-audit.md` with exactly this structure:

```markdown
# R-UI-1 + R-UI-2 Audit Report — Phase 1

**Date:** 2026-04-17
**Design spec:** docs/superpowers/specs/2026-04-17-r-ui-audit-design.md
**Surface audited:** R-UI-1 (merged, 62de54c..5cdcc1b) + R-UI-2 (branch feat/r-ui-2-impl, main..HEAD)
**Lanes dispatched:** 4 parallel specialists (Invariants, Plan Adherence, Code Quality, Doc-Skim)

## Executive Summary

<1 paragraph: total findings by severity (H/M/L), top 3 patterns observed, escalation pass/fail>

## Escalation Decision

**Phase 2 (full-codebase sweep) triggered: YES | NO**

Evaluation:
1. Any invariant-1-9 violation in non-adapter/non-seed code: YES (AUDIT-XXX) | NO
2. ≥3 High-severity findings: YES (N findings) | NO
3. Any doc-skip evidence: YES (AUDIT-XXX) | NO

<1-2 sentences: reasoning>

## Findings

<one subsection per finding, deduplicated and cross-referenced, in severity order (High first)>

### AUDIT-001: <title>
- **Severity:** High
- **Lane(s):** Invariants, Code Quality (cross-surfaced)
- **Violated:** invariant #N: "<quote>"
- **Evidence:** 
  ```
  path/to/file.ts:42
  <quoted excerpt>
  ```
- **Impact:** <1 sentence>
- **Direction:** <1 sentence>

### AUDIT-002: ...

## Patterns

<if multiple findings share a root cause, name the pattern here in a short subsection — this is the high-value section for preventing future drift>

### Pattern A: <name>
<1-2 sentences describing the pattern>
Findings: AUDIT-001, AUDIT-004, AUDIT-007

## What I Can't Audit

<explicit list of items specialists flagged as needing human judgment — subjective design choices, ambiguous-spec areas, decisions outside the audit's authority>

## Synthesis Notes

<document any lane reruns, downgrades, verification findings from Steps 1-6, zero-finding manual passes from Step 4>

## Appendix: Raw Specialist Outputs

- Lane 1 (Invariants): docs/superpowers/audits/.raw/lane-1-invariants.md
- Lane 2 (Plan Adherence): docs/superpowers/audits/.raw/lane-2-plan-adherence.md
- Lane 3 (Code Quality): docs/superpowers/audits/.raw/lane-3-code-quality.md
- Lane 4 (Doc-Skim): docs/superpowers/audits/.raw/lane-4-doc-skim.md
```

- [ ] **Step 9: Handle the "no findings" and "only Lows" cases**

If the report's findings section is empty: still commit the report, with the Executive Summary stating "No findings across all four lanes. Synthesis notes document the verification performed to confirm this."

If only Low findings: commit the report; the Executive Summary states "No High or Medium findings; N Low-severity items documented for tracking."

Both cases proceed to Task 8.

---

## Task 8: Commit the audit artifacts

**Files:**
- The audit report and all four raw files

- [ ] **Step 1: Stage everything**

```bash
git add docs/superpowers/audits/
git status
```

Expected: one new file (the report) plus four new raw files under `.raw/`.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs: R-UI-1 + R-UI-2 audit report — Phase 1 gate 1

Four-lane specialist audit (invariants, plan adherence, code quality,
doc-skim) of the R-UI-1 merge and R-UI-2 in-flight branch. Escalation
decision recorded. Raw specialist outputs preserved under .raw/ for
traceability. Remediation (gate 2) is a separate downstream decision.

Design spec: docs/superpowers/specs/2026-04-17-r-ui-audit-design.md
EOF
)"
```

Expected: pre-commit hook passes. If it fails on something unrelated to the audit (lint on an unrelated file touched by prior commits on the branch), investigate rather than `--no-verify`.

- [ ] **Step 3: Present the report to the user**

Show the Executive Summary and Escalation Decision sections. State the path of the committed report. Stop.

**Gate 1 is complete.** No remediation begins from this plan. The user decides what happens next (review report, request edits, proceed to gate 2, escalate to Phase 2, pause entirely).

---

## Self-Review Checklist

Ran against the design spec after writing the plan:

**Spec coverage:**
- [x] Four specialist lanes defined — Tasks 3, 4, 5, 6
- [x] Shared prompt kernel with required-reading gate and hard don'ts — Task 2
- [x] Anti-drift counters (required-reading quotes, evidence-mandatory, no self-cert, no deferral language, no scope expansion, blocker handling) — Task 2 Step 1
- [x] Mechanical checks pasted verbatim — required in Task 2 kernel and each lane
- [x] Synthesis-side counters (required-reading verify, mechanical-check re-run, spot-check hallucinations, flag zero-finding lanes) — Task 7 Steps 1-4
- [x] Escalation trigger evaluation — Task 7 Step 7
- [x] Report structure matches design Section 5 — Task 7 Step 8
- [x] "No findings" and "only Lows" cases handled — Task 7 Step 9
- [x] Gate 1 stops at committed report — Task 8 Step 3
- [x] Gate 2 and 3 explicitly out of scope — stated in plan header

**Placeholder scan:** No TBDs, no "TODO," no "similar to Task N." Every prompt is fully written. Every command is exact.

**Type consistency:** Finding ID conventions are consistent (AUDIT-INV-N, AUDIT-PLAN-N, AUDIT-CQ-N, AUDIT-DOC-N in raw files; AUDIT-001, AUDIT-002 after dedup in synthesis). File paths consistent throughout (absolute `/mnt/dev/fluxaos/...` in prompts, repo-relative in plan text).

**Known gaps accepted:**
- Exact "already-decided" list in the kernel is a curated subset; specialists may discover other settled decisions during required reading and should treat them as settled too.
- Mechanical-check command outputs will differ slightly depending on whether `grep` exits with 0 or 1 when no matches — this is fine, subagents paste stdout verbatim.
