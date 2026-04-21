# Audit Triage Decisions — Phase 1 + Phase 2 Reports

**Date:** 2026-04-17
**Inputs:**
- Phase 1 audit: `docs/superpowers/audits/2026-04-17-r-ui-1-r-ui-2-audit.md`
- Phase 2 audit: `docs/superpowers/audits/2026-04-17-phase2-full-codebase-audit.md`
- Design spec: `docs/superpowers/specs/2026-04-17-r-ui-audit-design.md`

**Purpose:** Capture user triage decisions against the 111 audit findings so future remediation planning has a stable, committed reference. Supersedes individual finding severities where this doc contradicts them.

---

## Pattern Triage

### Pattern 1 — Adapter registry decorative for 5 of 10 ports → **B (split)**

- **Real drift, fix via registry routing:** `auth`, `realtime`
- **Unbuilt features, separate scope call:** `ai`, `git`, `issue`, `notification`, `storage`

The distinction: auth/realtime have adapter implementations that consumers bypass via direct vendor imports — that's drift. The other five are ports without adapters, which is a feature-gap question, not an architectural failure.

### Pattern 2 — Half the alpha "Must Have" missing → **C + C1**

**Defer post-alpha (no remediation, no stubs retained):**
- Just Do It mode
- OpenAI adapter (Anthropic stays as the alpha AI provider)
- Brand service

**Build for alpha (remediation scope):**
- CLI (thin tRPC-client wrapper — ~1-2 days per user's framing: "single API, non-interactive commands share the API")
- GitHub adapter + `git`/`issue` port implementations
- Anthropic adapter (AIProvider port implementation) — **Resolved under R-REM-W3-a (2026-04-20).** The orchestrator's real AI path is `executeStageRun` → `SubprocessExecutor` (`StageExecutor` port) → `claude` binary → `SubprocessStdoutParser` (`StdoutParser` port; adapter landed in R-REM-W2). Seed data wires provider "Anthropic" → driver "claude-code" → model "Claude Sonnet 4.6" with `apiKeyRef: 'env:ANTHROPIC_API_KEY'`. The SDK-shaped `AIProvider` port (`complete`/`stream`/`listModels`/`healthCheck`) had zero consumers and was retired; if a direct-SDK path is ever needed it will be a separate port with a separate adapter, not a revival of the retired shape. End-to-end live-Claude journey proven by `e2e/real-anthropic-stage-run.spec.ts`.
- Settings tabs: Cron Jobs, Teams, Users, System, Stages, Projects
- Mission Control page

### Pattern 3 — Optimistic concurrency applied inconsistently → **A (fix everywhere)**

- Every mutable entity gets `version` column + version-locked mutations
- CRUD factory gains a versioned variant (dovetails with Pattern 4)
- `issue-comment` soft-delete wrapped in transaction
- Pipeline runtime tables (`pipeline_run`, `pipeline_stage`, `stage_run`) included — no exemptions

### Pattern 4 — No CRUD factory despite invariant 11 mandating one → **A (build properly, migrate all)**

- Design a real CRUD factory: versioned by default, type-safe (no `as any`), both service-layer and router-layer helpers
- Migrate all existing hand-rolled CRUD: `organization`, `project`, `provider`, `persona`, `skill`, `driver`, `issue-catalog` (including both `createCatalogCrud` + `createPriorityCrud` variants)
- Pattern 2's new entities use the factory from day one
- Extract shared helpers (`renderMarkdown`, `recordEvent`) to single sources

### Pattern 5 — Dead code → **C + C1 (delete everything not in scope, including schema tables)**

**Delete (non-exhaustive, see raw findings for full list):**
- `src/core/pipeline/types.ts`
- `src/core/brands/types.ts`, `personas/types.ts`, `skills/types.ts`
- `src/core/ports/notification.ts`, `storage.ts`
- `createBrandService`, `brands/` dir
- Any OpenAI scaffolding, Just Do It scaffolding
- `estimateCost` fake-0 pass-through
- Unused exports: `OUTPUT_FORMAT`, `isRule`, `registry.has()`, `trend` prop, `triggerRun` mutation
- Dead tRPC procedures: `issue.attachment.*`, `issue.dependency.*`, `issue.savedView.*`, `issue.stateOverride`, `close`, `reopen`, `users`, and dead CRUD paths on `organization`/`project`/`provider`/`persona`
- **AND their schema tables** (`issue_attachment`, `issue_dependency`, `issue_saved_view`) — per user C1 decision
- Phase 1's dead `stage-worker.ts`, `orchestrator/index.ts` barrel
- `src/core/pipeline/` empty directory

**Relocate out of `src/core/` (not delete — still needed, just wrong location):**
- `core/orchestrator/demo.ts`, `core/gates/demo.ts`, `core/db/scripts/connection.ts`, `core/db/seed.ts`, `core/db/nuke.ts` — all instantiate `SupabaseDatabaseProvider` inside core. Move to `src/scripts/` (or similar non-core path).

### Pattern 6 — Invariant 7 text vs verification script disagree on `drizzle-orm` → **B (pragmatic, amend prose)**

User's clarified framing:

> "Drizzle is a core app (like TypeScript, fastAPI, etc.) I don't want to overly be crazy about hardcoding of vendors/tools, we just need to be as modular config/adapter driven as possible"

**Two categories made explicit:**

**Core stack (locked-in infrastructure, invariant 7 does NOT apply):**
- TypeScript, Node.js, Next.js, React, tRPC, Tailwind, Drizzle ORM, Postgres engine
- These are the tech stack. Swapping any is a project rewrite, not a config change.
- Code should use generic terms where possible (e.g., `db.select()` not `drizzleDb.select()`, `QueryProvider` not `DrizzleProvider`), but runtime imports from these libraries are permitted in `src/core/`.

**Pluggable integrations (adapter-driven, invariant 7 DOES apply):**
- AI providers, Git hosts, Issue trackers, Auth backends, Realtime transports, Queue providers, Storage, Subprocess executors
- These are "systems you connect to" (ServiceNow, Supabase Auth, BullMQ, etc.).
- Must route through ports + adapter registry. No direct vendor imports in `src/core/`.

**Actions implied:**
1. Update `docs/invariants.md` §7 prose to add the two-category distinction explicitly.
2. Update the verification script to match (it already omits `drizzle-orm`, which is consistent with the amended reading).
3. ~20+ findings citing runtime drizzle imports in core evaporate as false positives under the clarified invariant.
4. Real invariant-7 violations that remain (because they are pluggable-vendor coupling, not core-stack):
   - `SupabaseDatabaseProvider` instantiated inside `src/core/` (CORE-1, CORE-2, CQ-ADAPT-10)
   - Anthropic Messages protocol embedded in `core/orchestrator/output-parser.ts` (Phase 1 AUDIT-013)

---

## D-Fork Resolutions

### D-1: `ARCHITECTURAL_STANDARDS.md` → **B (retire, merge into invariants)**

- Delete `ARCHITECTURAL_STANDARDS.md` (root)
- Audit its 14 numbered rules; any not already in `docs/invariants.md` gets added there
- Update cross-references in `CLAUDE.md`, session-quick-start, handoffs

**Rationale:** `docs/invariants.md` is already the source of truth. A parallel doc invites drift.

### D-2: Database port type leak (AUDIT-P2-CQ-CORE-20) → **A (accept, document)**

- `src/core/ports/database.ts`: add comment stating the Drizzle-typed `Database` is intentional per the Pattern 6 core-stack clarification.
- No code changes, no rename.
- Finding resolves as a false positive under the clarified invariant.

**Rationale:** Pattern 6 categorizes Drizzle as core stack. Abstracting its return type would contradict that triage.

---

## Net Scope Summary

**Starting findings:** 111 (35 High + 44 Medium + 32 Low)

**Reclassifications after triage:**
- ~20+ drizzle-runtime findings → false positives (Pattern 6)
- `AUDIT-P2-CQ-CORE-20` → false positive (D-2)
- 3 items deferred post-alpha (Just Do It, OpenAI, Brand — Pattern 2)

**Work added via scope commitments (not findings):**
- 11 alpha-critical build items (Pattern 2)

**Actionable remediation scope — estimated ~55-65 work items across three buckets:**

1. **Alpha-critical build:** CLI, GitHub adapter, Anthropic adapter, 6 Settings tabs, Mission Control
2. **Architecture remediation:** CRUD factory + migrations, optimistic concurrency everywhere, auth/realtime registry routing, `SupabaseDatabaseProvider` relocation out of core, Anthropic-protocol extraction from `output-parser.ts`
3. **Cleanup + documentation:** Dead code deletion (Pattern 5), schema-table drops, invariant 7 amendment (text + script), `ARCHITECTURAL_STANDARDS.md` retirement, roadmap update (new phases before R6)

---

## Remediation Wave Plan

Waves are dependency-ordered: later waves consume the output of earlier ones.

### Wave 1 — Foundation (scoped for next implementation plan)

Must land first because later waves build on these:
- Invariant 7 amendment (text + verification script)
- `ARCHITECTURAL_STANDARDS.md` retirement + any missing principles merged into `docs/invariants.md`
- CRUD factory design + implementation (versioned, type-safe)
- Dead code deletion per Pattern 5 (plus schema-table drops for dead procedures)
- Relocate out-of-core files (demos, db scripts) to `src/scripts/`
- Comment on `core/ports/database.ts` re: intentional Drizzle typing

### Wave 2 — Architecture remediation

Consumes Wave 1:
- Migrate existing entities onto the CRUD factory (organization, project, provider, persona, skill, driver, issue-catalog)
- Add version columns + version-locked mutations to all mutable entities missing them
- Wrap `issue-comment` soft-delete in transaction
- Route auth through `AuthProvider` port (delete `@supabase/ssr` duplicates from `lib/supabase/`)
- Register `realtime` in adapter registry; route all consumers through `registry.get<RealtimeProvider>`
- Relocate Anthropic Messages protocol parser into an adapter

### Wave 3 — Alpha-critical build

Consumes Wave 1 (CRUD factory) + Wave 2 (adapter registry):
- CLI: `src/cli/` thin tRPC-client wrapper for non-interactive commands
- GitHub adapter: `src/adapters/github/` with GitProvider + IssueProvider implementations
- Anthropic adapter: `src/adapters/anthropic/` with AIProvider implementation
- Settings tabs: Cron Jobs, Teams, Users, System, Stages, Projects (uses new CRUD factory)
- Mission Control page (reads existing orchestrator state)

### Wave 4 — Cleanup + Polish

Remaining non-blocking items:
- Low-severity findings not in earlier waves
- Spec + roadmap reconciliation (document what landed, what deferred, updated phase structure)
- Re-run audit to confirm no regressions

---

## Deferred Items (Post-Alpha)

Explicitly out of remediation scope. Document in roadmap as post-alpha:
- Just Do It mode
- OpenAI adapter (second AI provider)
- Brand service / Brand identity features
- Notification provider
- Storage provider (beyond local filesystem if ever needed)

---

## Open Observations (Not Acted On)

These surfaced during audits but are not triage decisions — flagged here for awareness:

- **Self-certification pattern (AUDIT-P2-DOC-9)** survived into R5-V/R5.5 despite R3.5 enforcement infrastructure. Mechanical enforcement alone was not sufficient; each phase's human-verification checkbox still requires cultural discipline.
- **Security posture of LAN auth bypass (Phase 1 AUDIT-017)** — scope-creep from R-UI-1. Not part of this remediation but worth a focused security lane in a future audit.
- **N+1 queries in `pipeline.runs.get`** (Phase 1 overflow) — performance concern; not blocking but flagged.
