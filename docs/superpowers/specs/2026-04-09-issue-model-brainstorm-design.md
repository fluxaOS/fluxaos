# Rich Issue Model — Brainstorming Design Addendum

**Date:** 2026-04-09
**Status:** Approved
**Context:** Captures decisions from brainstorming session that supplement the DA-reviewed rich issue model spec.
**Base spec:** `docs/superpowers/specs/2026-04-09-rich-issue-model-design.md`

## What This Document Adds

The base spec defines the schema, API endpoints, UI requirements, and migration strategy. This addendum captures architectural decisions made during brainstorming that affect how the spec is implemented.

## Decision 1: Multi-Tenancy Hierarchy

GitHub-style: Organization → User → Project.

- **Organization** owns users. Has no issues, pipelines, or project-level data.
- **User** belongs to an org. Owns projects.
- **Project** contains everything: issues, pipelines, settings, skills, personas, routing.

Two users in the same org can each have a project called "flux" — completely independent.

**Schema change:** Add `userId` (FK → user) to the `project` table.

**URL pattern:** `/[org]/[user]/[project]/issues/[number]`

**For alpha:** One org, one user, one or more projects. Schema and routes designed for multi-tenancy from day one.

## Decision 2: Route Structure

The dashboard UI design (PR #12) established the visual language under `/dashboard/`. This must be reconciled with multi-tenant routing.

**Action:** Move all pages from `/dashboard/` to `/[org]/[user]/[project]/`. The visual components (Card, StatCard, PageHeader, StatusBadge, Skeleton, EmptyState) and the glassmorphism design carry over — only the route structure changes.

**Nav sidebar** scoped to the current org/user/project context with a project switcher.

## Decision 3: Orchestrator vs Worker Separation

Two actors in the system with completely different database permissions:

**The Orchestrator (systemd daemon):**
- Manages all pipeline state: issue state, status, priority, stage transitions
- Evaluates rules engine (gates, transitions, routing)
- Assigns work to AI workers via the job queue
- Reads worker results, updates the database accordingly
- Only actor that writes pipeline/issue state to the database

**AI Workers (pure executors):**
- Receive a prompt + context from the queue
- Do the work
- Add a comment to the issue with their results
- Done. They don't know they're part of a pipeline.
- Database is read-only for workers (except comments)
- Can add comments (with author attribution)
- Can edit their own comments (with audit trail)
- Cannot delete comments
- Cannot modify issue state, status, priority, type, or pipeline stage

**API enforcement:** The issue service and tRPC endpoints must support role-based write restrictions. Worker-role callers can only call comment.create and comment.update (own comments). All other mutations require orchestrator or user role.

## Decision 4: Testing Philosophy

- **No unit tests.** Permanently banned. Zero unit tests in the codebase.
- **Integration tests** against real Supabase only. Verify CRUD, constraints, relationships.
- **Journey test** is the real test. User does real things in real browser. Grows incrementally.
- **User verification** at every checkpoint. Agent claims are not verification.
- **Provider/harness swap** must not break the journey (agnosticism test).

## Decision 5: Nuke-and-Seed Script

Required for every verification checkpoint:
1. Drop all user-configurable/user-created data
2. Seed default catalogs (types, states, statuses, priorities, labels, transitions, status automation)
3. Seed default org, user, project
4. Optionally load fake/mock data

Every test starts from known state. No stale data.

## Decision 6: Deferred Features

- **Kanban view** — deferred. List view with stage summary cards is sufficient for now.
- **"Just Do It"** — placeholder concept only. Future interactive planning feature that asks questions, builds a plan, creates issues, feeds them into the pipeline. Name will change (Nike trademark). No implementation now.
- **Real-time pipeline monitoring** — required but lands in R5 with the pipeline engine. Supabase Realtime powers live output streaming so users can watch what AI workers are actually doing.

## Decision 7: Existing Hardcoded Code Must Be Deleted

The current codebase has hardcoded enums and transition maps that violate the agnosticism invariants:

- `src/core/issues/types.ts` — hardcoded `IssueState`, `IssuePriority`, `IssueType`, `VALID_TRANSITIONS` → DELETE
- `src/app/dashboard/issues/[id]/page.tsx` — hardcoded `VALID_TRANSITIONS` map → REPLACE with DB query
- `src/app/dashboard/issues/page.tsx` — hardcoded `states`, `types`, `priorities` arrays → REPLACE with DB query
- `src/app/dashboard/page.tsx` — hardcoded state/priority string comparisons → REPLACE with catalog lookups

All of these become database-driven catalog queries.
