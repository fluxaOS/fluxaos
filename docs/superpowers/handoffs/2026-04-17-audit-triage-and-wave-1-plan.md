# Session Handoff — Multi-Team Audit, Triage, and Wave 1 Plan

**Date:** 2026-04-17 (session ran ~3 hours)
**Branch:** `feat/r-ui-2-impl`
**Status:** Audit complete, triage decisions committed, Wave 1 remediation plan ready for execution

---

## What Happened This Session

User flagged drift in recent agent work: deferrals, hardcoding, vendor coupling, re-litigating settled decisions, agents skimming docs. Session produced:

1. **Multi-team audit design** (`docs/superpowers/specs/2026-04-17-r-ui-audit-design.md`) — 4 specialist lanes, evidence-mandatory findings, required-reading gates, anti-drift mechanics
2. **Audit plan** (`docs/superpowers/plans/2026-04-17-r-ui-audit-plan.md`)
3. **Phase 1 audit executed** (R-UI-1 + R-UI-2 surfaces) — 28 findings (8H / 14M / 9L); escalated to Phase 2
4. **Phase 2 audit executed** (full codebase minus Phase 1) — 80 findings (27H / 30M / 23L)
5. **Triage synthesis** (`docs/superpowers/audits/2026-04-17-audit-triage.md`) — user-led decisions across 6 patterns + 2 D-forks
6. **Wave 1 plan** (`docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md`) — 9 tasks, foundation-layer remediation

No code changes made to the application. Only docs/specs/plans/audit-reports committed.

---

## Commits On Branch (this session)

Starting branch tip was `4345e3c`. This session added (in order):

```
ede55fa docs: design spec for R-UI-1 + R-UI-2 multi-team audit
b7e4173 docs: implementation plan for R-UI audit Phase 1 gate 1
491fdf4 docs: R-UI-1 + R-UI-2 audit report — Phase 1 gate 1
8ec6d49 docs: Phase 2 full-codebase audit report
[this handoff's commit] — triage + Wave 1 plan + handoff
```

---

## Triage Decisions (Authoritative)

See `docs/superpowers/audits/2026-04-17-audit-triage.md` for full text. Key decisions:

**Pattern 1 — Adapter registry decorative for 5/10 ports:** Split into *real drift* (auth, realtime — fix via registry routing in Wave 2) and *unbuilt features* (ai, git, issue, notification, storage — scope commitments, not drift).

**Pattern 2 — Half alpha "Must Have" missing:**
- **Defer post-alpha:** Just Do It mode, OpenAI adapter, Brand service
- **Build for alpha (Wave 3):** CLI, GitHub adapter, Anthropic adapter, 6 Settings tabs, Mission Control

User framing that resolved the CLI question: "If we have a single API, what's the issue with all non-interactive CLI commands?" — answer: none. CLI is a thin tRPC-client wrapper, ~1-2 days of work.

**Pattern 3 — Optimistic concurrency:** Fix everywhere (Wave 2). CRUD factory gains versioned variant (Wave 1). Pipeline runtime tables included — no exemptions.

**Pattern 4 — CRUD factory:** Build properly, migrate all. Wave 1 builds it; Wave 2 migrates existing entities onto it.

**Pattern 5 — Dead code:** Delete everything not in remediation scope (including schema tables for dead procedures). All happens in Wave 1.

**Pattern 6 — Drizzle invariant text vs script:** Pragmatic. User's framing: "Drizzle is a core app (like TypeScript, fastAPI, etc.) — I don't want to overly be crazy about hardcoding of vendors/tools, we just need to be as modular config/adapter driven as possible." Core stack (TypeScript, Next.js, Drizzle, Postgres) is infrastructure; pluggable integrations (AI, Git, Auth, Realtime, Queue, Storage, Subprocess) are the invariant-7 target. Names should be generic; imports of core stack are fine in `src/core/`.

**D-1 — ARCHITECTURAL_STANDARDS.md:** Retire. `docs/invariants.md` is authoritative.
**D-2 — Database port Drizzle type:** Accept as documented infrastructure (comment-only change).

---

## Net Scope After Triage

- **Findings invalidated as false positives under the clarified invariant 7:** ~20+ (drizzle runtime imports in core)
- **Findings deferred post-alpha:** ~5 (Just Do It, OpenAI, Brand, notification, storage)
- **Scope commitments added:** ~11 (Pattern 2 build items)
- **Actionable remediation scope:** ~55-65 work items across four waves

---

## Remediation Waves

### Wave 1 — Foundation (plan already written, ready to execute)

`docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md`

9 tasks. Zero user-facing changes. Produces:
- Invariant 7 amendment (text + script)
- ARCHITECTURAL_STANDARDS retirement
- ports/database.ts intentional-typing comment
- CRUD factory with versioned variant + integration tests
- Unused exports deleted (OUTPUT_FORMAT, isRule, registry.has, trend prop, triggerRun)
- Dead source files deleted (brand service, 3 issue-feature services, type-only dead modules, 2 unused ports, orchestrator barrel, stage-worker)
- Dead schema tables dropped (issue_attachment, issue_dependency, issue_saved_view) via migration 0006
- Dead tRPC procedures removed from issue router
- Out-of-core files relocated to `src/scripts/` (demos, db CLI scripts, seed/nuke)
- End-to-end verification including user browser confirmation

**Execute with:** `superpowers:subagent-driven-development` against the plan. Or inline per Approach 1 gate-3 protocol.

### Wave 2 — Architecture remediation (plan not yet written)

Dependencies: Wave 1 must land first. Scope:
- Migrate existing entities onto CRUD factory: `organization`, `project`, `provider`, `persona`, `skill`, `driver`, `issue-catalog`
- Add version columns + version-locked mutations to mutable entities missing them (persona, provider, organization, project, pipeline family, issue.updateStatus)
- Wrap `issue-comment` soft-delete in transaction
- Route auth through `AuthProvider` port — delete `@supabase/ssr` duplicates from `lib/supabase/` in favor of a single adapter-layer home
- Register `realtime` in adapter registry; route `lib/realtime/context.tsx` through `registry.get<RealtimeProvider>`
- Relocate Anthropic Messages protocol parser out of `core/orchestrator/output-parser.ts` into an adapter (Phase 1 AUDIT-013)

### Wave 3 — Alpha-critical build (plan not yet written)

Dependencies: Wave 1 (factory) + Wave 2 (registry). Scope:
- CLI: `src/cli/` thin tRPC-client wrapper for non-interactive commands
- GitHub adapter: `src/adapters/github/` with GitProvider + IssueProvider implementations
- Anthropic adapter: `src/adapters/anthropic/` with AIProvider
- Settings tabs: Cron Jobs, Teams, Users, System, Stages, Projects (using new CRUD factory)
- Mission Control page (reads existing orchestrator state)

### Wave 4 — Cleanup + polish (plan not yet written)

- Remaining low-severity findings not addressed in earlier waves
- Spec + roadmap reconciliation: document what landed, what deferred, updated phase structure
- Re-run a targeted audit to confirm no regressions
- Browser verification of the full journey test

---

## Open Observations (Not Acted On)

Flagged for awareness, not in remediation scope:

- **Self-certification pattern** survived into R5-V/R5.5 despite R3.5 enforcement infrastructure. Mechanical enforcement alone isn't sufficient; the human-verification gate keeps being bypassed culturally. Worth addressing in Wave 4's polish by making the PR template's manual-verification checkbox a merge blocker, or by a pre-merge hook that checks PR body.
- **Security posture of LAN auth bypass (Phase 1 AUDIT-017)** — scope-creep from R-UI-1. Needs its own security lane in a future audit.
- **N+1 queries in `pipeline.runs.get`** — performance, not correctness. Flagged in Phase 1 overflow.

---

## Next Session Start

Suggested opening:

```
Continuing from 2026-04-17 audit handoff.

Current state:
- Branch: feat/r-ui-2-impl
- Triage decisions committed: docs/superpowers/audits/2026-04-17-audit-triage.md
- Wave 1 plan committed: docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md
- R-UI-2 implementation paused per earlier handoff (task 11 complete, tasks 12+ pending)

Wave 1 is ready to execute. Three options for the session:

1. Execute Wave 1 directly (9 tasks, zero user-facing changes, atomic commits per task)
2. Write the Wave 2 plan (architecture remediation) before executing Wave 1 — longer session but makes downstream dependencies explicit
3. Resume R-UI-2 task 12+ first — the audit paused R-UI-2's implementation

My recommendation: option 1 (execute Wave 1). It's foundation work, small commits, clear exit criteria, and clears the decks for Wave 2 planning to be against the cleaned-up codebase.
```

---

## References

- Phase 1 audit report: `docs/superpowers/audits/2026-04-17-r-ui-1-r-ui-2-audit.md`
- Phase 2 audit report: `docs/superpowers/audits/2026-04-17-phase2-full-codebase-audit.md`
- Triage synthesis: `docs/superpowers/audits/2026-04-17-audit-triage.md`
- Wave 1 plan: `docs/superpowers/plans/2026-04-17-wave-1-foundation-plan.md`
- Audit design spec: `docs/superpowers/specs/2026-04-17-r-ui-audit-design.md`
- Audit plan (Phase 1 gate 1): `docs/superpowers/plans/2026-04-17-r-ui-audit-plan.md`
- Raw specialist outputs: `docs/superpowers/audits/.raw/` (Phase 1) + `.raw-phase2/` (Phase 2)
- R-UI-2 implementation pause (separate concern): `docs/superpowers/handoffs/2026-04-17-r-ui-2-implementation-session-a-paused.md`
