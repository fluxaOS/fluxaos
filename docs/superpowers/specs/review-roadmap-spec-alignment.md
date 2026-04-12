# Review: Roadmap v2 & Spec v2 Alignment with Codebase + Paul's Planning

> **Date:** 2026-04-08
> **Scope:** Gap analysis comparing `fluxaos-planning` docs (roadmap v2, spec v2, DA review) against `fluxaos` codebase state and Paul's planning progress.

---

## Current Codebase State (3 commits on `main`)

```
450cf71  chore: initial scaffold — Next.js 15, directory structure, Docker Compose
34bb56d  chore: remove auto-generated CLAUDE.md and AGENTS.md
bc50c75  fix: remap redis host port to 6380 (6379 used by central_redis)
```

The repo is a **skeleton only** — directory structure with `.gitkeep` placeholders, dependencies installed, Docker Compose working. No business logic, no schemas, no interfaces, no tests.

---

## Paul's Planning Progress (from `.paul/STATE.md`)

- **Milestone:** v0.1.0-alpha — ~4% complete
- **Phase:** 1 of 7 (Foundation & Skeleton) — 25% complete (1 of 4 plans)
- **Plan 01-01 (Scaffold):** COMPLETE — produced the 3 commits above
- **Plan 01-02 (Drizzle Schema):** CREATED, awaiting `/paul:apply`
- **Loop position:** PLAN created, ready for APPLY
- **Last activity:** 2026-04-08

---

## Phase 1 Deliverables: Done vs. Not Done

```
Phase 1: Foundation & Skeleton
├── [DONE] GitHub repo with directory structure + path aliases
├── [DONE] Docker Compose (fluxaos + postgres + redis)
├── [DONE] Dependencies installed (tRPC, Drizzle, Supabase SDK, BullMQ, etc.)
├── [DONE] TypeScript strict mode + path aliases (@/core, @/adapters, etc.)
│
├── [PLANNED - 01-02] Drizzle schema (18+ tables from spec data model)
├── [PLANNED - 01-02] Seed script (default org, project, pipeline + 4 stages)
├── [PLANNED - 01-02] db:generate, db:migrate, db:seed scripts
│
├── [NOT YET PLANNED] core/ports/ — 10 port interfaces (currently empty export)
├── [NOT YET PLANNED] adapters/supabase/ — auth + realtime adapters
├── [NOT YET PLANNED] adapters/bullmq/ — queue adapter
├── [NOT YET PLANNED] config/ — adapter registry (env var resolution)
├── [NOT YET PLANNED] tRPC router skeleton (empty routers per domain)
├── [NOT YET PLANNED] Auth flow (login/logout via Supabase Auth)
├── [NOT YET PLANNED] App shell (layout, nav, empty pages — still default Next.js)
├── [NOT YET PLANNED] CI: lint + type-check + Vitest
└── [NOT YET PLANNED] AGPLv3 license file
```

Paul's planning splits Phase 1 into 4 sub-plans. Only 01-01 and 01-02 exist so far — presumably 01-03 and 01-04 would cover ports, adapters, tRPC skeleton, auth, CI, and the app shell.

---

## Spec v2 Data Model vs. Codebase

The spec defines **18+ core entities**. Plan 01-02 (awaiting apply) targets all of them:

| Entity | Spec Status | Code Status |
|--------|-------------|-------------|
| Organization | Defined | No schema |
| Project | Defined | No schema |
| Pipeline | Defined | No schema |
| PipelineStage | Defined | No schema |
| PipelineRun | Defined | No schema |
| StageRun | Defined | No schema |
| Event (append-only) | Defined | No schema |
| Issue | Defined | No schema |
| IssueEvent | Defined | No schema |
| Provider | Defined | No schema |
| Model | Defined | No schema |
| RoutingProfile | Defined | No schema |
| RoutingRule | Defined | No schema |
| Persona | Defined | No schema |
| Skill | Defined | No schema |
| PersonaSkill | Defined | No schema |
| Team | Defined | No schema |
| TeamMember | Defined | No schema |
| Brand | Defined | No schema |
| Memory | Defined | No schema |
| ConfigEntry | Defined | No schema |

**None of these exist in code yet.** Plan 01-02 would create them all in one batch.

---

## Spec v2 Port Interfaces vs. Codebase

The spec defines **10 port interfaces**. `src/core/ports/index.ts` is currently `export {};`.

| Port | Purpose | Alpha Adapter | Code Status |
|------|---------|---------------|-------------|
| GitProvider | Git hosting (PRs, branches) | GitHub | Not defined |
| IssueProvider | External issue sync | GitHub Issues | Not defined |
| AIProvider | LLM API calls | Anthropic, OpenAI | Not defined |
| AuthProvider | Authentication | Supabase Auth | Not defined |
| DatabaseProvider | Connection + config | Supabase Postgres | Not defined |
| QueueProvider | Job queue ops | BullMQ | Not defined |
| RealtimeProvider | Live subscriptions | Supabase Realtime | Not defined |
| StageExecutor | Subprocess execution | Node.js (execa) | Not defined |
| NotificationProvider | Alerts | (none in alpha) | Not defined |
| StorageProvider | File/artifact storage | Local filesystem | Not defined |

---

## Alignment Observations

### 1. Roadmap Phasing Matches Paul's Approach

Paul's plan-apply-unify loop is well-aligned with the roadmap's "deep-dive per phase" instruction. Phase 1 is being broken into granular sub-plans (01-01 scaffold, 01-02 schema, presumably 01-03 ports/adapters, 01-04 tRPC/auth/CI). This is methodical and sound.

### 2. Codebase Structure Matches Spec Exactly

The directory layout in the repo matches the spec's project structure diagram perfectly:
- `src/core/{ports,pipeline,routing,issues,agents,skills,gates,observability}/`
- `src/adapters/{github,supabase,bullmq,anthropic,openai,node-exec}/`
- `src/app/`, `src/components/`, `src/cli/`, `src/config/`

### 3. Tech Stack Matches Spec

Dependencies in `package.json` align with the spec's tech stack table:
- Next.js 16.2.2 (spec says 15 — **minor discrepancy**, actually shipped with 16)
- React 19.2.4
- tRPC 11
- Drizzle ORM 0.45
- Supabase SDK (`@supabase/ssr`, `@supabase/supabase-js`)
- BullMQ
- ioredis
- execa
- Zod (v4)
- Vitest
- Playwright
- Tailwind CSS 4

### 4. Docker Compose Matches Spec

3 containers (fluxaos, postgres, redis) with Supabase Cloud external — exactly as spec and DA review concluded after the critical finding about self-hosted Supabase complexity.

### 5. DA Review Findings Are Addressed in Architecture

- **Critical #1 (Supabase self-hosted):** Resolved — using Supabase Cloud + raw Postgres
- **Critical #2 (Phase 1 overscoped):** Partially addressed — Paul's sub-plan approach splits Phase 1 into pieces, but the roadmap still says "Week 1-3"
- **Critical #3 (fhc sunset):** Addressed — fhc stays until flux proven

### 6. Key Deferred Issues Still Open

From Paul's STATE.md, these remain unresolved:
- CLI authentication model (PAT vs Supabase session) — deferred to Phase 2
- Supabase Auth middleware containment — deferred to Phase 1 (not yet planned)
- Test harness for transcript simulation — deferred to Phase 4
- Node.js subprocess Python escape hatch — deferred to Phase 6
- Supabase Realtime throughput — deferred to Phase 4

---

## Potential Concerns

### A. Next.js Version Discrepancy

Spec says Next.js **15**, codebase has Next.js **16.2.2**. This is likely fine (newer is usually better), but the spec should be updated to reflect reality if it's being used as the source of truth.

### B. Phase 1 Remaining Work Is Substantial

After 01-02 (schema), Phase 1 still needs:
- 10 TypeScript port interfaces
- 3 adapter implementations (supabase auth, supabase realtime, bullmq)
- Adapter registry with env var resolution
- tRPC router skeleton
- Auth flow (login/logout)
- App shell (currently default Next.js landing page)
- CI pipeline
- License file

This is likely 2 more sub-plans (01-03, 01-04) worth of work.

### C. No Tests Exist Yet

`tests/` contains only `.gitkeep`. CI setup (lint + type-check + Vitest) is a Phase 1 deliverable that hasn't been addressed yet. Given the roadmap's emphasis on each phase producing "testable software," tests should come early.

### D. App Still Shows Default Next.js Page

`src/app/page.tsx` still has the `create-next-app` boilerplate with Vercel deploy links. The app shell (layout, nav, empty pages) is a Phase 1 deliverable.

### E. README Is Still Default

`README.md` is the standard Next.js create-next-app readme. While the full README is a Phase 7 deliverable, the Phase 1 exit criteria mention a working app — a minimal project description would be appropriate.

---

## Summary: Where Things Stand

```
Roadmap v2 (7 phases, 14 weeks)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Phase 1 ▓▓░░░░░░░░ 25% (scaffold done, schema planned, ports/auth/tRPC/CI pending)
Phase 2 ░░░░░░░░░░  0% (issues, skills, CLI, GitHub sync)
Phase 3 ░░░░░░░░░░  0% (personas, routing config, brands)
Phase 4 ░░░░░░░░░░  0% (pipeline engine, state machine, gates)
Phase 5 ░░░░░░░░░░  0% (web UI)
Phase 6 ░░░░░░░░░░  0% (AI provider adapters)
Phase 7 ░░░░░░░░░░  0% (observability, polish, ship)

Overall: ~4% of alpha milestone
```

**Architecture alignment: STRONG.** The codebase skeleton, tech stack, directory structure, Docker Compose, and dependency choices all match the spec precisely. Paul's planning approach (granular sub-plans per phase) is methodical and well-suited to the roadmap's "deep-dive per phase" instruction.

**Progress: EARLY.** Only the scaffold exists. The next concrete step is applying 01-02 (Drizzle schema with 18+ tables), then building port interfaces, adapter registry, tRPC skeleton, auth, and CI to complete Phase 1.
