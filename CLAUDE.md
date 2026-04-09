# fluxaOS — Project Intelligence

## What This System Is

fluxaOS is an AI orchestration OS. It manages pipelines of AI-powered stages that process issues. The user configures everything: what stages exist, what rules govern transitions between them, what AI providers and models are available, what personas and skills are used, and how routing decisions are made.

**Read this section carefully. If you don't understand it, you will build the wrong thing.**

The system is a **machine**, not a **solution to a specific problem**. It does not know what it's processing. It does not know the names of stages, providers, models, or harnesses. It reads configuration from the database, follows the rules the user defined, and produces output. Whether there is one stage or fifty, whether the provider is Anthropic or OpenAI or something that doesn't exist yet — the machine runs identically because it only knows: "read the current stage, evaluate the rules, execute via the configured provider, transition to whatever the data says is next."

This is what makes it agnostic. The application code never contains the word "research" or "implement" or "Anthropic" or "claude-code." It contains "current stage," "next stage," "configured provider," "configured harness." The user fills in the blanks through configuration, and the engine executes whatever they configured.

If you hardcode stage names, provider names, model names, or workflow logic, you have broken the system. You have built a solution to one workflow instead of a machine that runs any workflow. This is the single most important architectural principle.

### The Heart of the System

Four things make fluxaOS work. Without all four, there is nothing to ship:

1. **Issues** — the core data model, fully database-driven catalogs for types, states, statuses, priorities, labels, transitions. No hardcoded enums.
2. **Pipeline** — stages execute, gates evaluate, transitions follow DB-driven rules. The engine adapts to any number of stages in any configuration.
3. **Rules Engine** — the backend that evaluates gate conditions, enforces transitions, and drives the pipeline. Without this, nothing works.
4. **"Just Do It"** — prompt goes in, issue is created, pipeline runs, output comes back. This is the user-facing proof that the heart works.

### Why This Rewrite Exists

The previous implementation (PAT, a Python/FastAPI system) has the right design but doesn't work. The rules engine doesn't fire. The pipeline doesn't execute properly. Stages don't flow. It looks good but doesn't drive.

fluxaOS is the ground-up rewrite in TypeScript. Supabase was chosen to get auth, realtime, and storage without building them. PAT's data model and UI patterns are the blueprint — the reference for how things should look and what tables/fields are needed. But the backend must actually work this time.

The first eight phases of this rewrite went off course: agents made autonomous architecture decisions, hardcoded values appeared, no human testing was done, and phases were self-certified as complete. That code was gutted. We are rebuilding correctly.

---

## Two Actors: The Orchestrator and The Workers

This is one of the most important architectural decisions in the system. There are two types of actors, and they have completely different responsibilities:

### The System Service (systemd daemon) — The Orchestrator

This is the brain. It runs as a background service on a heartbeat. It:
- Wakes up on its heartbeat interval
- Checks the database for issues that need work
- Evaluates the rules engine (gates, transitions, routing)
- Assigns work to AI workers via the job queue
- Reads results back from workers
- Updates issue state, status, priority, pipeline stage — all database writes for pipeline progression
- Transitions issues to the next stage based on the rules
- Records events and audit trail entries

The orchestrator is the ONLY actor that manages pipeline state. It decides what happens next. It writes to the database.

### The AI Workers — Pure Executors

AI workers are dumb pipes. They:
- Receive a task from the queue: a prompt, a skill, a context
- Do the work (write code, research, review, etc.)
- Report what they did by adding a comment to the issue
- That's it. They're done.

AI workers do NOT:
- Know what pipeline stage they're in
- Know the issue's state, status, or priority
- Poll the database to check status
- Update issue state, status, priority, type, or pipeline stage
- Delete comments
- Make any pipeline or routing decisions

AI workers treat the database as **read-only** (except for adding/editing their own comments). They don't know they're part of a pipeline. They get a prompt, do the work, report back. The orchestrator handles everything else.

**Why this matters:** In PAT, AI workers were polling the database every 3-5 minutes, burning through the Anthropic API plan in a single day. The AI was doing the orchestrator's job. That's wrong. The systemd service does the orchestrating. The AI does the work. Clean separation.

**Comment permissions for AI workers:**
- Can add comments (with author attribution)
- Can edit their own comments (with audit trail: who, when, old value, new value)
- Cannot delete comments
- Every add/edit creates an audit trail entry

---

## Invariants — Rules That Are Never Violated

These are not guidelines. These are hard constraints. Every piece of work must satisfy all of them. If your work violates any invariant, it is wrong regardless of whether it "works."

### Agnosticism

1. **No stage name appears in application code.** The words "research," "implement," "review," "deploy," "complete," "rework" must never appear in src/ except in seed data files and test fixtures. The engine references `currentStage`, `nextStage`, `stage.name` — never a literal stage name.

2. **No provider or model name appears in application code.** The words "anthropic," "openai," "claude," "gpt" must never appear in src/ except in adapter registration (src/adapters/) and seed data. The engine references `configuredProvider`, `resolvedModel` — never a literal provider name.

3. **No harness name appears in application code.** The words "claude-code," "aider," "codex" must never appear in src/ except in adapter registration and seed data.

4. **No hardcoded enums for user-configurable data.** Issue types, states, statuses, priorities, labels, transitions, gate rules, routing rules — all come from database tables. If a value should be configurable by the user, it lives in the database, not in code.

5. **The engine runs identically with any number of stages.** One stage, five stages, fifty stages — zero code changes required. Adding a stage means adding database rows, not touching application code.

6. **Adding a new provider requires zero application code changes.** Only database rows (provider, models, routing rules) and optionally a new adapter file in src/adapters/.

### Architecture

7. **Zero vendor imports in src/core/.** No Supabase, no Drizzle (except `import type` and schema definitions), no BullMQ, no provider SDKs. Core services receive dependencies via injection. The adapter registry is the only resolution path.

8. **All services use dependency injection.** Services are factory functions that receive `Database` as a parameter. No singletons. No direct imports of adapters or connections.

9. **Everything is config-driven.** No fallback defaults. No silent degradation. If a required configuration is missing, the system fails fast with a clear error message naming what's missing. A misconfigured system crashes immediately — it does not silently do the wrong thing.

10. **Max ~500 lines per file.** Split into multiple files when approaching this limit.

11. **DRY strictly enforced.** Use the CRUD factory pattern. No copy-paste between services, routers, or adapters. If you find yourself duplicating logic, extract it.

### Data Integrity

12. **Optimistic concurrency on all mutable entities.** Issues, comments, and any entity that can be edited concurrently must use version fields. Update queries include `WHERE version = $expected`. Zero rows affected means conflict — return 409, not silent overwrite.

13. **Events are immutable.** The event tables are append-only. No updates. No deletes. They are the audit trail.

14. **Body HTML is rendered at write time.** Markdown bodies are rendered to HTML when created or updated, and the HTML is stored. Never render at read time.

### Testing

15. **No unit tests. Ever.** Zero unit tests in fluxaOS. Do not write them. Do not suggest them. Do not sneak them in alongside other work. Unit tests burned tokens, provided false confidence, and never caught a single real bug. This is non-negotiable.

16. **Integration tests hit real Supabase.** These test that the database layer actually works — real Postgres via the transaction pooler. They verify CRUD operations, constraints, and relationships. Not mocks. Not in-memory databases. These are the safety net, not the primary test.

17. **The journey test is the real test.** A real user (or Playwright acting as one) does real things in a real browser against a real database: log in, create an issue, edit it, transition states, add/edit/delete comments, fire the pipeline, watch it execute, verify the database matches the UI, verify the output. If one step fails, the entire journey fails. The journey test grows incrementally as features land.

18. **Real-time observability is required.** The user must be able to see what a running pipeline stage is actually doing — live output, not a spinner. This is critical for development, debugging, and verifying that long-running executions are actually working. Supabase Realtime was chosen specifically for this.

19. **CLI must pass the same journey.** Everything the browser can do, the CLI can do. Same operations, same results, same database. Both interfaces are first-class.

20. **Provider/harness swap must not break the journey.** If you change one configuration value (swap Anthropic for OpenAI, swap claude-code for aider), the entire journey test must still pass for both browser and CLI. This is the ultimate agnosticism test.

### Process

21. **No phase is complete without human verification.** An agent saying "this works" or "tests pass" is not verification. The user must see the result in a running browser or confirm via API output. Self-certification is explicitly forbidden.

22. **Architecture deviations are flagged, not decided.** If an implementation choice differs from the spec or these invariants, stop and flag it to the user. Do not make the decision autonomously and move on. The previous failure was exactly this.

23. **Small phases with checkpoints.** Break work into pieces small enough that drift is caught early. Each checkpoint produces something the user can verify.

---

## Verification Protocol

Before claiming any work is complete, run these checks and show the results:

```bash
# Invariant 1-3: No hardcoded stage/provider/harness names in application code
# (exclude seed files, test fixtures, adapters/, and this CLAUDE.md)
grep -rn '"research"\|"implement"\|"review"\|"deploy"\|"complete"\|"rework"' src/ \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=__tests__ --exclude-dir=adapters \
  | grep -v 'seed\|fixture\|\.test\.' || echo "PASS: No hardcoded stage names"

grep -rn '"anthropic"\|"openai"\|"claude"\|"gpt"' src/ \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=adapters \
  | grep -v 'seed\|fixture\|\.test\.' || echo "PASS: No hardcoded provider names"

# Invariant 4: No hardcoded enums for configurable data
grep -rn "type IssueState\|type IssuePriority\|type IssueType" src/core/ \
  | grep -v 'import\|\.test\.' && echo "FAIL: Hardcoded issue enums found" \
  || echo "PASS: No hardcoded issue enums"

# Invariant 7: No vendor imports in core
grep -rn "from '@supabase\|from 'bullmq\|from 'ioredis\|from '@anthropic\|from 'openai" src/core/ \
  | grep -v 'import type' && echo "FAIL: Vendor imports in core" \
  || echo "PASS: No vendor imports in core"

# Invariant 10: File length check
find src/ -name '*.ts' -o -name '*.tsx' | while read f; do
  lines=$(wc -l < "$f")
  [ "$lines" -gt 500 ] && echo "WARN: $f has $lines lines (max ~500)"
done || echo "PASS: All files under 500 lines"

# Invariant 15: No unit tests
find src/ -name '*.test.ts' -o -name '*.spec.ts' | while read f; do
  grep -L 'supabase\|DATABASE_URL\|integration' "$f" 2>/dev/null
done | grep . && echo "FAIL: Unit test files found (only integration tests allowed)" \
  || echo "PASS: No unit tests"
```

These checks are necessary but not sufficient. They catch mechanical violations. Architectural drift — like building stage-specific logic that technically doesn't use string literals but still assumes a fixed workflow — requires human judgment. That's why every phase needs user verification.

---

## Reference Architecture

**Source of truth:** PAT at `/mnt/dev/pat/` — specifically:
- Data models: `src/pat/core/orchestrator/models/issues_native.py`
- Seed data: `src/pat/core/orchestrator/issue_catalog_defaults.py`
- API routes: `src/pat/api/routes/v2/issues.py`
- Frontend types: `frontend/src/types/v2.ts`
- Frontend components: `frontend/src/components/Issue*.tsx`
- Pipeline manager: `src/pat/core/orchestrator/manager.py`

**Design spec:** `docs/superpowers/specs/2026-04-09-rich-issue-model-design.md`
**Rebuild plan:** `docs/superpowers/plans/2026-04-09-rebuild-plan.md`
**Rebuild spec:** `docs/superpowers/specs/2026-04-09-rebuild-spec.md`

## Tech Stack

- Next.js 16, React 19, TypeScript 5
- tRPC v11 with Zod validation
- Drizzle ORM with postgres-js driver
- Supabase Cloud (Postgres, Auth, Realtime)
- BullMQ + Redis for job queue
- Tailwind CSS 4
- Playwright for journey tests (E2E)
- Integration tests via Vitest against real Supabase (no unit tests)

## Multi-Tenancy Model

GitHub-style hierarchy: Organization → User → Project. An org owns users. A user owns projects. Each project contains everything: issues, pipelines, settings, skills, personas, routing. Two users can have projects with the same name — they are completely independent.

URL pattern: `/[org]/[user]/[project]/issues/1`

For alpha: one org, one user, one or more projects. The schema and routes are designed for multi-tenancy from day one so it's a feature addition later, not a rewrite.

## Current State

Phases R1-R2 complete. R3 partially done (basic CRUD for all entities works against Supabase). The issue model uses hardcoded enums and must be overhauled to database-driven catalogs per the design spec. The pipeline engine, rules engine, and routing system are not yet built.

A dashboard UI design (glassmorphism, bento grid, card system) was merged via PR #12. It establishes the visual language and shared components (Card, StatCard, PageHeader, StatusBadge, Skeleton, EmptyState) under a `/dashboard/` route structure. This needs to be reconciled with the multi-tenant `/[org]/[user]/[project]/` routing.

## Development Database

There is no production database. This is a pre-alpha development project with zero users. The Supabase Cloud database is the development database.

**Nuke-and-seed script:** A script must exist that:
1. Drops all user-configurable/user-created data (issues, comments, events, pipeline runs, etc.)
2. Seeds default catalog data (issue types, states, statuses, priorities, labels, transitions, status automation config)
3. Seeds a default org, user, and project
4. Can optionally load fake/mock data for development and testing

Every verification checkpoint starts from a known state: nuke, seed, then verify. No stale data, no mystery state from previous sessions. Agents should never hesitate about modifying the database — there is nothing to protect.
