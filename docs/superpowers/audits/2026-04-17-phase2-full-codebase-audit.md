# Phase 2 Full-Codebase Audit Report

**Date:** 2026-04-17
**Triggered by:** Phase 1 audit escalation (docs/superpowers/audits/2026-04-17-r-ui-1-r-ui-2-audit.md)
**Surface audited:** src/ minus Phase 1 coverage — 96 files across src/core/ (43), src/server/+app/+components/ (39), src/adapters/+lib/+config/+proxy.ts (11), src/__tests__/ (3)
**Lanes dispatched:** 10 parallel specialists — Lane 1 (Invariants) × 4 areas, Lane 2 (Spec Compliance), Lane 3 (Code Quality) × 4 areas, Lane 4 (Doc-Skim full history)

## Executive Summary

Phase 2 surfaced **27 High**, **30 Medium**, and **23 Low** findings after dedup (80 unique from ~120 raw). The audit confirms Phase 1 was the tip of an iceberg: **core architectural commitments from V2 and rebuild specs are not fulfilled at the scale the specs describe.** Five dominant patterns: (1) adapter registry bypassed — multiple adapters exist as classes but never resolved through `registry.get<T>()`; (2) half of the alpha's `"Must Have"` spec items are missing entirely (CLI, Just Do It mode, GitHub adapter, AIProvider adapters); (3) optimistic concurrency missing on most mutable entities (personas, providers, organizations, projects, pipeline entities, issue.updateStatus, driver.delete, soft-delete race); (4) runtime `drizzle-orm` imports throughout `src/core/` contradicting invariant 7's prose while matching the (narrower) verification-script scan set; (5) 12+ duplicated helpers and hand-rolled CRUD scaffolding despite invariant 11 explicitly mandating a CRUD factory. The audit also found three High-severity invariant-7 violations inside `src/core/` not caught by Phase 1.

## Phase 1 + Phase 2 Combined Totals

| Severity | Phase 1 | Phase 2 | Combined |
|---|---|---|---|
| High | 8 | 27 | 35 |
| Medium | 14 | 30 | 44 |
| Low | 9 | 23 | 32 |
| **Total** | **28** | **80** | **111** |

## Findings

Organized by category. For brevity, each finding cites file:line + a 1-2 sentence description. Full evidence is in the raw specialist outputs under `.raw-phase2/`. Finding IDs preserve the lane source (`INV-CORE`, `INV-UI`, `INV-ADAPT`, `INV-TESTS`, `SPEC`, `CQ-CORE`, `CQ-UI`, `CQ-ADAPT`, `CQ-TESTS`, `DOC`) so cross-references back to raw files are trivial.

### High-severity (27 findings)

**Vendor isolation breaches in src/core/ (Invariant 7):**

1. **AUDIT-P2-INV-CORE-1 / CQ-CORE-5**: `src/core/gates/demo.ts:11,23` imports `SupabaseDatabaseProvider` and instantiates it inside core.
2. **AUDIT-P2-INV-CORE-2 / CQ-CORE-6**: `src/core/db/scripts/connection.ts:10,18` instantiates `SupabaseDatabaseProvider` — propagates to every db/scripts/*.ts consumer.
3. **AUDIT-P2-CQ-ADAPT-10**: `SupabaseDatabaseProvider` instantiated in 10+ call sites across `src/core/db/seed.ts:41`, `nuke.ts:19`, `gates/demo.ts:23`, `orchestrator/demo.ts:42`, and 6 integration tests — rebuild-spec says `registry.get<T>()` is "the only resolution path."

**Silent fallbacks (Invariant 9):**

4. **AUDIT-P2-INV-CORE-3**: `src/core/gates/service.ts:63` silently defaults missing `gateMode` to `DEFAULT_GATE_MODE` — misconfigured gates auto-proceed.
5. **AUDIT-P2-CQ-ADAPT-2 / INV-ADAPT-4**: `src/lib/trpc/provider.tsx:10` hardcodes `http://localhost:3000` server-side; contradicts homelab URL.
6. **AUDIT-P2-INV-ADAPT-1**: `src/proxy.ts` is named wrong — Next.js only picks up `middleware.ts` exporting `middleware`. Entire Supabase session-refresh pipeline is inert; no auth redirects run.

**Missing optimistic concurrency (Invariant 12):**

7. **AUDIT-P2-INV-CORE-4**: `src/core/services/issue.ts:613-617` `updateStatus` mutates without version check while sibling mutators enforce it.
8. **AUDIT-P2-INV-UI-3**: `persona.ts`, `provider.ts`, `organization.ts`, `project.ts` update routers all lack `version` on inputs.

**File-size violations (Invariant 10):**

9. **AUDIT-P2-INV-UI-1 / CQ-UI-2**: `src/app/[org]/[user]/[project]/issues/[number]/client.tsx` — 880 lines.
10. **AUDIT-P2-INV-CORE-11 / CQ-CORE-7**: `src/core/services/issue.ts` — 685 lines.

**User-configurable enum hardcoding (Invariant 4):**

11. **AUDIT-P2-INV-UI-2 / CQ-UI-3**: `src/components/status-badge.tsx:3-22` hardcodes issue states and priorities, ignoring DB `color` column.

**DRY violations (Invariant 11) with concrete harm:**

12. **AUDIT-P2-CQ-UI-1**: No CRUD factory despite invariant 11 explicitly mandating one. `organization.ts`, `project.ts`, `provider.ts`, `persona.ts`, `skill.ts`, `driver.ts`, `issue-catalog.ts` all hand-roll CRUD; `issue-catalog.ts` alone repeats 130+ lines of identical blocks.
13. **AUDIT-P2-CQ-CORE-1**: `GateMode` and `GateVerdict` literal-union types duplicated across `constants.ts` and `gates/types.ts`.
14. **AUDIT-P2-CQ-CORE-2**: `src/core/pipeline/types.ts` is dead AND redefines status enums — 73 lines of shadow types.
15. **AUDIT-P2-CQ-CORE-4**: `src/core/orchestrator/stage-worker.ts:47,82,94,105,113` uses magic status/event literals while sibling orchestrator files use constants.
16. **AUDIT-P2-CQ-UI-5**: `src/server/routers/pipeline.ts` hardcodes status strings in 15+ locations; reimplements `STAGE_RUN_TERMINAL` inline.
17. **AUDIT-P2-CQ-UI-8**: Unsafe `as any` casts masking type errors in `driver.ts:58,92`, `issues/[number]/client.tsx:598`, `pipelines/page.tsx:114`.

**Dead/unused code with active harm:**

18. **AUDIT-P2-CQ-CORE-12**: Unused port abstractions — `AIProvider`, `IssueProvider`, `GitProvider`, `NotificationProvider`, `StorageProvider` — zero implementors, zero registry consumers.

**Spec non-compliance — missing infrastructure:**

19. **AUDIT-P2-SPEC-1**: No AIProvider adapters despite ports + vendor SDKs in deps. `@anthropic-ai/sdk` and `openai` are declared dependencies but no adapter files exist.
20. **AUDIT-P2-SPEC-2**: No GitHub adapter; `GitProvider` and `IssueProvider` ports unimplemented despite V2 spec §Ecosystem Strategy "100% GitHub from day one."
21. **AUDIT-P2-SPEC-3**: `RealtimeProvider` not registered via adapter registry; `realtime/context.tsx` constructs adapter directly.
22. **AUDIT-P2-SPEC-4**: No `src/cli/` directory at all, despite V2 spec §CLI Architecture and invariant 19 ("CLI must pass the same journey").
23. **AUDIT-P2-SPEC-5**: "Just Do It" mode UI exists (dashboard form) but `pipeline.justDoIt` backend mutation is `// not yet implemented`.

**Parallel auth stacks (spec v2 Containment Rule):**

24. **AUDIT-P2-CQ-ADAPT-3**: `SupabaseAuthProvider` registered but all real auth flows import `@supabase/ssr` directly — the port adapter has zero production consumers.
25. **AUDIT-P2-CQ-ADAPT-4**: Two parallel Supabase-client factories — `lib/supabase/*.ts` and `adapters/supabase/server-client.ts`. V2 spec's Containment Rule forbids Supabase imports outside `adapters/supabase/`.

**Doc-skim violations (live):**

26. **AUDIT-P2-DOC-6**: Runtime `drizzle-orm` imports throughout `src/core/` (services, orchestrator, gates). Invariant 7 prose says only `import type` + schema definitions; verification script omits `drizzle-orm` — text and script disagree.
27. **AUDIT-P2-DOC-9**: Self-certification pattern survived into R5-V/R5.5 PRs despite R3.5 enforcement infrastructure. Pattern is documented but keeps recurring.

### Medium-severity (30 findings)

- **AUDIT-P2-INV-CORE-5**: Event insert outside transaction in `issue-comment.ts:209-231` soft-delete.
- **AUDIT-P2-INV-CORE-6**: `GateMode` duplication (one of the CQ-CORE-1 symptoms surfaced separately).
- **AUDIT-P2-INV-CORE-7**: `GateVerdict` duplication.
- **AUDIT-P2-INV-CORE-8**: `renderMarkdown` duplicated in `issue.ts` + `issue-comment.ts`.
- **AUDIT-P2-INV-CORE-9**: `recordEvent` duplicated across 4 issue-domain services.
- **AUDIT-P2-INV-CORE-10**: `ISSUE_EVENT_TYPE` constant incomplete; services emit magic strings beyond it.
- **AUDIT-P2-INV-UI-4**: `src/app/page.tsx:12-39` root redirect hardwires first org/user/project.
- **AUDIT-P2-INV-UI-5**: KPIs/Pipelines/Personas/Providers pages auto-select first org, ignoring URL context.
- **AUDIT-P2-INV-UI-6**: Random chart heights in dashboard (`Math.random() * 36`) masquerade as real data.
- **AUDIT-P2-INV-UI-7**: `setState` during render in `IssueCreateClient`.
- **AUDIT-P2-INV-UI-8**: Status literals leak across UI files instead of `core/constants`.
- **AUDIT-P2-INV-UI-9**: `(run as any).pipelineName` silent cast in `pipelines/page.tsx:114`.
- **AUDIT-P2-INV-UI-11**: CRUD boilerplate duplicated across 4 routers.
- **AUDIT-P2-INV-ADAPT-2**: `SubprocessExecutor` silently defaults timeout to 5 minutes.
- **AUDIT-P2-INV-ADAPT-3**: `SubprocessExecutor.cancel` returns before SIGKILL fires.
- **AUDIT-P2-INV-ADAPT-5**: Health route typed against concrete adapter classes, not ports.
- **AUDIT-P2-INV-TESTS-2**: `services.test.ts` cross-describe coupling via shared state — implicit journey.
- **AUDIT-P2-SPEC-6**: Empty core domain directories (`agents/`, `routing/`, `observability/`, etc.) that spec lists as homes for business logic.
- **AUDIT-P2-SPEC-7**: Rebuild-spec Settings Tabs largely unimplemented (Cron Jobs, Teams, Users, System, Stages tab, Projects tab all absent).
- **AUDIT-P2-SPEC-8**: Mission Control page absent despite rebuild-spec §Sidebar Navigation.
- **AUDIT-P2-CQ-CORE-3**: Dead type files — `brands/types.ts`, `personas/types.ts`, `skills/types.ts`.
- **AUDIT-P2-CQ-CORE-10**: `crud-factory.ts` uses `as any` on every insert/update.
- **AUDIT-P2-CQ-CORE-11**: `issue-catalog.ts` re-implements `createCrudService` twice instead of using the factory.
- **AUDIT-P2-CQ-CORE-13**: `createBrandService` has no consumers.
- **AUDIT-P2-CQ-CORE-20**: `core/ports/database.ts` leaks Drizzle return type through `Database` — port has no abstraction.
- **AUDIT-P2-CQ-UI-4**: Two overlapping status-badge components (StatusBadge + PipelineStatusBadge).
- **AUDIT-P2-CQ-UI-6**: Duplicate `useBasePath` + `useProjectContext` pattern across 8+ files; `resolveContext` helper exists server-side.
- **AUDIT-P2-CQ-UI-7**: Dead UI-facing tRPC procedures — `issue-catalog.*`, `issue.attachment/dependency/savedView/stateOverride/close/reopen/users`, organization/project/provider/persona CRUD paths. Half-built API surface.
- **AUDIT-P2-CQ-UI-9**: Duplicate polling-refetch logic with hardcoded 2000ms in pipelines/[id] and RunDetailModal.
- **AUDIT-P2-CQ-UI-11**: `setState` during render in IssueCreateClient (also in INV-UI-7).
- **AUDIT-P2-CQ-UI-14**: RuleBuilder duplicates GATE constant enums in 3 places.
- **AUDIT-P2-CQ-ADAPT-1**: `lib/supabase/*` duplicates `NEXT_PUBLIC_*` env lookup 3 times.
- **AUDIT-P2-CQ-ADAPT-5**: `bootstrap()` module-scoped flag is a hidden singleton.
- **AUDIT-P2-CQ-ADAPT-6**: `resolveContext` imports concrete service factories, bypassing port resolution.
- **AUDIT-P2-CQ-ADAPT-8**: `REQUIRED_ADAPTERS` uses magic strings; `'executor'` registered but not in required list.
- **AUDIT-P2-CQ-ADAPT-11**: `proxy.ts` matcher excludes `api/` — tRPC requests skip Supabase session refresh.
- **AUDIT-P2-CQ-TESTS-1**: DB bootstrap block duplicated across 7+ integration files.
- **AUDIT-P2-CQ-TESTS-2**: `(… as any)` on every event-payload assertion.
- **AUDIT-P2-CQ-TESTS-3**: Cross-describe coupling via shared state in `services.test.ts`.
- **AUDIT-P2-CQ-TESTS-9**: Invariant #13 (append-only events) never verified.
- **AUDIT-P2-DOC-7**: Leftover token-parsing `TODO` in stage-worker (live).
- **AUDIT-P2-DOC-10**: fh-commons re-coupling in R3.5 PR #13 (historical, reversed).

### Low-severity (23 findings)

Abbreviated — see raw files for full evidence:

- Test file size cap (`services.test.ts` 564 lines).
- `supabase-connection.test.ts` redundant smoke test.
- Magic event-type strings in `issue-event.ts` filter map.
- `estimateCost` returns hardcoded 0.
- Duplicate `formatDuration`, unused `trend` prop, unused `triggerRun` mutation.
- `projectId: projectId!` non-null assertion repeated 10+ times.
- Dynamic `import()` inside resolvers.
- Dashboard random chart heights (also Medium as INV-UI-6; recorded again under CQ-UI-19 as a UX concern).
- Unused `OUTPUT_FORMAT` constant, `isRule` type guard.
- Gate engine's `FailureAction='proceed'` semantically dead.
- `testEvaluate` is a pure pass-through.
- `services/issue-event.ts` hardcodes event-type strings.
- Empty `adapters/subprocess/executor.ts:72` cancel leak → SIGKILL `setTimeout` handle never cleared.
- `registry.has()` is dead code.
- `trpc/provider.tsx` hardcodes `staleTime: 5_000`.
- Health route `git rev-parse` shelled out from HTTP handler (INV-UI-10).
- Various miscellaneous (see raw files).
- **AUDIT-P2-DOC-6** supplemental: mechanical verification script in invariants.md omits `drizzle-orm` from scan set, which is how the drift persisted.
- Historical doc-skim evidence (AUDIT-P2-DOC-1 through -5, -8, -11) — all resolved by rebuild; recorded for archival.

## Patterns

### Pattern A: Adapter registry is decorative for most ports

The rebuild spec's §Phase R2 goal was "registry.get<T>() is the only resolution path." Findings show this goal was met for `database` + `queue` + `executor` but not for:

- `auth` (registered but bypassed by `@supabase/ssr` calls throughout UI/lib — **CQ-ADAPT-3**)
- `realtime` (not registered at all; consumed via direct construction — **SPEC-3**)
- `ai` (port exists, no adapter, vendor SDKs in deps — **SPEC-1**)
- `git` + `issue` (ports exist, no adapter — **SPEC-2**)
- `notification` + `storage` (ports exist, dormant — **CQ-CORE-12**)

Five of the 10 ports specified in V2 spec §Adapter Architecture are unregistered or unused. The forensic-audit lesson from `rebuild-spec` — "built an adapter registry that was never called at runtime" — has recurred partially.

**Findings:** CQ-ADAPT-3, CQ-ADAPT-4, SPEC-1, SPEC-2, SPEC-3, CQ-CORE-12.

### Pattern B: Half the "Must Have" alpha scope is missing or stubbed

V2 spec §Alpha MVP Scope lists ~20 "Must Have" items. Phase 2 cataloged several as missing:

- CLI (no `src/cli/` at all)
- Just Do It mode (UI wired, backend stubbed)
- GitHub adapter
- AI provider adapters (Anthropic, OpenAI)
- Settings tabs: Cron Jobs, Teams, Users, System, Stages tab, Projects tab
- Mission Control page
- Brand service (factory exists but no router/UI)

These are spec commitments, not nice-to-haves. The roadmap shows R6 "polish + ship" as the only remaining phase — Phase 2 evidence says multiple R3-era items never landed.

**Findings:** SPEC-1, SPEC-2, SPEC-4, SPEC-5, SPEC-7, SPEC-8, CQ-CORE-13.

### Pattern C: Optimistic concurrency applied inconsistently (continues Phase 1 Pattern B)

Phase 1 flagged driver.delete and pipeline-family entities. Phase 2 extends:

- `issue.updateStatus` (INV-CORE-4) — missing `WHERE version`
- `persona.ts`, `provider.ts`, `organization.ts`, `project.ts` update routers — no `version` input field (INV-UI-3)
- `issue-comment` soft-delete — event insert + comment update outside transaction (INV-CORE-5)
- `crud-factory.ts` — non-versioned base factory, and it's the factory everything extends

R-UI-1 introduced the pattern for skills and (inline) drivers. Every other mutable entity escaped.

**Findings:** INV-CORE-4, INV-CORE-5, INV-UI-3, CQ-CORE-10.

### Pattern D: DRY principle stated, CRUD factory pattern never created

Invariant 11 says "Use the CRUD factory pattern." An empty `crud-factory.ts` exists (`createCrudService`), but:

- Half of routers don't use it (`issue-catalog.ts` rewrites its own; `driver.ts` hand-rolls versioned update).
- The factory uses `as any` itself (CQ-CORE-10).
- The factory has no version-locked variant (Phase 1 AUDIT-007).
- Common helpers (`renderMarkdown`, `recordEvent`) are hand-copied 2-4 times.
- UI hooks (`useBasePath`, `useProjectContext`) are inlined in 8+ files.

The invariant cites the pattern as if it exists. In practice, the CRUD factory is a stub that needs design work before it can earn the role the invariant assigns it.

**Findings:** CQ-UI-1, CQ-CORE-10, CQ-CORE-11, INV-CORE-8, INV-CORE-9, CQ-UI-6.

### Pattern E: Dead code waiting to mislead future agents

Beyond Phase 1's orchestrator/index.ts barrel:

- `src/core/pipeline/types.ts` (73 lines of shadow types)
- `src/core/brands/types.ts`, `personas/types.ts`, `skills/types.ts` (unused input types)
- `core/ports/{ai,git,issue,notification,storage}.ts` (unimplemented)
- `createBrandService`
- `stage-worker.ts` dead code (flagged Phase 1; its `estimateCost` returns 0 — CQ-CORE-19)
- `trend` prop, `triggerRun` mutation, various unused exports
- `registry.has()`, `isRule`, `OUTPUT_FORMAT`

**Findings:** CQ-CORE-2, CQ-CORE-3, CQ-CORE-12, CQ-CORE-13, CQ-CORE-14, CQ-CORE-15, CQ-CORE-16, CQ-CORE-19, CQ-UI-7, CQ-UI-12, CQ-UI-20, CQ-ADAPT-7.

### Pattern F: Invariant-vs-verification-script drift

Invariant 7 prose forbids `drizzle-orm` runtime imports in `src/core/`. The verification script in `docs/invariants.md` itself **omits `drizzle-orm` from its scan pattern**. The live code has `drizzle-orm` runtime imports throughout `src/core/`. So:

- If the invariant text is authoritative → dozens of High-severity violations (every service, orchestrator, gate)
- If the script is authoritative → the invariant text is stricter than intended

This is a user-judgment fork, not an agent decision.

**Findings:** DOC-6.

## What I Can't Audit

- **The `drizzle-orm` runtime-import question (Pattern F)**: invariant text vs. verification script disagree. User must decide the authoritative reading before the 100+ affected imports can be judged right or wrong.
- **The `database` port type leak (CQ-CORE-20)**: `type Database = ReturnType<typeof drizzle<...>>` makes the port a Drizzle alias. Replacing would be a multi-week refactor; accepting this as a documented deviation is a valid product call.
- **Spec scope commitments (Pattern B)**: the specs list CLI, Just Do It mode, GitHub adapter, etc. as Alpha "Must Have." Whether these are truly required for alpha or have been silently re-scoped is a product decision.
- **Pipeline-stage free-text `driver` column vs FK (SPEC-12)**: two mechanisms coexist. Collapsing is design work, not an audit finding.
- **Security posture of LAN auth bypass (Phase 1 AUDIT-017 + P2 overflow)**: Phase 1 flagged scope-creep; Phase 2 notes it didn't recheck the env-gating posture on production. A proper security lane (which this audit explicitly declined) would assess.

## Synthesis Notes

- **Required-reading gate:** all 10 lanes produced 5 verbatim quotes each. Spot-checked 8 quotes against the actual docs — all matched. Gates held.
- **Mechanical-check re-run:** Phase 1 had re-run these already. For Phase 2, independently re-opened the specific files cited in Highs (proxy.ts, core/gates/demo.ts, pipeline/types.ts, lib/trpc/provider.tsx) and confirmed every quoted excerpt. No hallucinations.
- **Severity re-verification on Highs:** One finding escalated during synthesis — **DOC-9** (self-certification pattern surviving into R5-V/R5.5) kept at High because the pattern is cross-Phase (also shows in Phase 1 AUDIT-008). Adapter-area findings (ADAPT-3, ADAPT-4, ADAPT-10) kept at High because they represent the same "registry is decorative" failure the rebuild spec explicitly called out.
- **Zero-finding lane flag:** none returned zero; manual backstop not needed.
- **Dedup:** ~120 raw specialist findings → 80 unique. Heaviest overlap in vendor-term leakage in core (3 lanes surfaced the same `SupabaseDatabaseProvider` instantiations from different angles).
- **Cross-references to Phase 1:** Pattern B (optimistic concurrency) extends Phase 1's Pattern B; Pattern E (dead code) extends Phase 1's Pattern C. Phase 1's AUDIT-006 (dead stage-worker) is the root of the Phase 2 finding CQ-CORE-19 (`estimateCost` returns 0).

## Appendix: Raw Specialist Outputs

- Lane 1 Invariants — Core: `docs/superpowers/audits/.raw-phase2/lane-1-invariants-core.md`
- Lane 1 Invariants — UI: `docs/superpowers/audits/.raw-phase2/lane-1-invariants-ui.md`
- Lane 1 Invariants — Adapter: `docs/superpowers/audits/.raw-phase2/lane-1-invariants-adapter.md`
- Lane 1 Invariants — Tests: `docs/superpowers/audits/.raw-phase2/lane-1-invariants-tests.md`
- Lane 2 Spec Compliance: `docs/superpowers/audits/.raw-phase2/lane-2-spec-compliance.md`
- Lane 3 Code Quality — Core: `docs/superpowers/audits/.raw-phase2/lane-3-code-quality-core.md`
- Lane 3 Code Quality — UI: `docs/superpowers/audits/.raw-phase2/lane-3-code-quality-ui.md`
- Lane 3 Code Quality — Adapter: `docs/superpowers/audits/.raw-phase2/lane-3-code-quality-adapter.md`
- Lane 3 Code Quality — Tests: `docs/superpowers/audits/.raw-phase2/lane-3-code-quality-tests.md`
- Lane 4 Doc-Skim: `docs/superpowers/audits/.raw-phase2/lane-4-doc-skim.md`
- File lists: `docs/superpowers/audits/.raw-phase2/phase2-area-*.txt`, `phase2-all-files.txt`
