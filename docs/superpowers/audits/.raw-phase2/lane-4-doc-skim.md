# Phase 2 — Lane 4 Doc-Skim — Full History (pre-R-UI-1)

## Required-reading proof

- **invariants.md:** "Zero vendor imports in src/core/..."
- **spec v2:** "No vendor coupling..."
- **rebuild-spec:** "Zero vendor imports in `core/`..."
- **CLAUDE.md:** "DI everywhere — services are factories receiving Database, zero vendor imports in src/core/"
- **session-quick-start.md:** "Requires `.env` with: `DATABASE_URL`..."

## Findings

### AUDIT-P2-DOC-1: Phase 1 seed commit claims "Zero vendor imports in core/" while placing pg + drizzle runtime imports in core/db/index.ts
- **Pattern:** contradicts-invariant
- **Severity:** High (historical — R1 rebuild corrected)
- **Locus:** commit `39a6dbb` — `src/core/db/index.ts`
- **Doc:** invariants.md #7
- **Evidence:** File contained `import { drizzle } from "drizzle-orm/node-postgres"; import pg from "pg";` + `new pg.Pool({...})` in src/core/.
- **Direction:** Already fixed by R1/R2.

### AUDIT-P2-DOC-2: Phase 2 hardcoded IssueState/IssuePriority/IssueType enums
- **Pattern:** contradicts-invariant
- **Severity:** High (historical — resolved by rebuild schema overhaul cf116c7)
- **Locus:** commit `a1c36637` — `src/core/issues/types.ts`
- **Doc:** invariants.md #4
- **Direction:** Already fixed.

### AUDIT-P2-DOC-3: Phase 4 gate engine hardcoded rule-condition vocabulary + silent "pass by default"
- **Pattern:** contradicts-invariant
- **Severity:** High (historical — R4 replaced with declarative engine)
- **Locus:** commit `7699070760` — `src/core/gates/engine.ts`
- **Doc:** invariants #4 + #9
- **Evidence:** `switch (condition) { case 'exit_code_zero': ... default: return true; }`
- **Direction:** Already fixed by `ddfc195`.

### AUDIT-P2-DOC-4: Phase 4 worker silent fallback to `providerName:'none'` / `harness:'claude-code'`
- **Pattern:** contradicts-invariant
- **Severity:** High (historical — R5 rewrote)
- **Locus:** commit `7699070760` — `src/adapters/bullmq/worker.ts`
- **Doc:** invariants #9 and spec v2 Founding Principle #2
- **Direction:** Already resolved.

### AUDIT-P2-DOC-5: Phases 2/7 shipped pure unit tests (vi.mock / vi.stubEnv / no DB), Phase 8 labelled them "E2E"
- **Pattern:** contradicts-invariant
- **Severity:** High (historical — gutted by R1; archetypal doc-skim)
- **Locus:** commits `743e1773`, `7699070760`, `e5ef78bf`, `44b8386c`
- **Doc:** invariants #15 + rebuild-spec forensic finding
- **Direction:** Already fixed.

### AUDIT-P2-DOC-6: Runtime drizzle-orm imports throughout `src/core/` — LIVE AT TIP
- **Pattern:** contradicts-invariant
- **Severity:** High (live — the only live finding in this lane)
- **Locus:** At `62de54c~1` (pre-R-UI-1): `orchestrator/*.ts`, `services/*.ts`, `gates/service.ts`, `db/seed.ts`/`nuke.ts`/`scripts/*`
- **Doc:** invariants.md #7 (excludes only `import type` and schema definitions)
- **Evidence:** `import { eq, and, sql } from 'drizzle-orm';` (runtime) throughout core. Verification script in invariants.md **omits `drizzle-orm`**, suggesting the invariant text was stricter than implementation intent.
- **Direction:** User decision: (a) loosen invariant 7 prose to explicitly allow drizzle query-builder helpers OR (b) push runtime drizzle behind a port/helper. Verification script and prose should be reconciled.

### AUDIT-P2-DOC-7: Leftover token-parsing TODOs in stage-worker (live)
- **Pattern:** undocumented-deviation
- **Severity:** Low
- **Locus:** `src/core/orchestrator/stage-worker.ts:90,167`
- **Doc:** invariants #22 + #9
- **Evidence:** `tokensIn: 0, // TODO: parse from provider output`
- **Direction:** Implement or remove.

### AUDIT-P2-DOC-8: Phase 7/8 self-certified "complete" + "all 8 phases done" despite forensic audit finding broken work
- **Pattern:** contradicts-invariant
- **Severity:** High (historical — trigger event for the rebuild)
- **Locus:** commit `44b8386c` + PR #11 body
- **Doc:** invariants #21
- **Evidence:** PR #11: "Phase 8 complete, all 8 phases done" — no browser, no human verification.
- **Direction:** Already addressed by rebuild-spec and memory entry "No Self-Certification."

### AUDIT-P2-DOC-9: Multiple pre-R-UI-1 PRs proclaimed phases "complete" via tests alone — identical pattern invariant 21 forbids
- **Pattern:** relitigates-decision
- **Severity:** Medium
- **Locus:** PR #19, #20, #29, #5 bodies
- **Doc:** invariants #21; CLAUDE.md "No self-certification"
- **Evidence:** PR #20 title claims browser verification; body has unchecked `[ ] Cancel button during active run`. PR #29 Test Plan has 4 unchecked checkboxes.
- **Direction:** Pattern survived into R5-V/R5.5 despite R3.5 enforcement — enforcement infrastructure is insufficient.

### AUDIT-P2-DOC-10: PR #13 (R3.5) wired fluxaOS back into fh-commons skill sync after spec v2 declared clean break
- **Pattern:** relitigates-decision
- **Severity:** Medium (historical — reversed 2026-04-15)
- **Locus:** PR #13 body
- **Doc:** spec v2 §Ecosystem Strategy "No fhc dependency"
- **Direction:** Reversed per `project_fhc_decoupling.md`.

### AUDIT-P2-DOC-11: `harness` terminology used Phase 1 → R5-V despite spec v2 agnosticism principle
- **Pattern:** rename-without-doc-update (inverse)
- **Severity:** Low
- **Locus:** commits `1a7ab414` → `ba7817eb`
- **Doc:** invariants #3
- **Direction:** Already settled (R-UI-1 rename).

## Phase 2 overflow candidates

- **AUDIT-P2-DOC-6** is the only live finding — user decision on invariant 7 text vs verification script.
- **AUDIT-P2-DOC-7** small but live.
- **AUDIT-P2-DOC-9** — self-certification pattern survived into R5-V/R5.5; R3.5 enforcement is insufficient.

## Blocked

None.
