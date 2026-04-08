# Project State

## Project Reference

See: .paul/PROJECT.md (updated 2026-04-08)

**Core value:** Orchestrate any AI workflow end-to-end with configurable pipelines, provider-agnostic routing, gate-controlled quality, and full observability — no vendor lock-in.
**Current focus:** Phase 3 — Personas & Configuration

## Current Position

Milestone: v0.1.0-alpha
Phase: 3 of 7 (Personas & Configuration) — In Progress
Plan: 03-01 complete (Persona core + inheritance + tRPC routes)
Status: Loop closed, ready for next PLAN
Last activity: 2026-04-08 — Plan 03-01 UNIFY complete

Progress:
- Milestone: [▓▓▓░░░░░░░] ~29% (2 of 7 phases complete)
- Phase 3: [▓▓▓░░░░░░░] ~33% (1 of 3 plans complete)

## Loop Position

Current loop state:
```
PLAN ──▶ APPLY ──▶ UNIFY
  ✓        ✓        ✓     [Loop complete — ready for next PLAN]
```

## Accumulated Context

### Decisions

| Decision | Phase | Impact |
|----------|-------|--------|
| Use central_databases stack (not per-project Docker) | Phase 1, Plan 02 | postgres via pgbouncer on :5432, redis on :6379 with auth; docker-compose.yml stripped |
| Apply migrations via direct SQL (drizzle-kit migrate hangs) | Phase 1, Plan 02 | Workaround for drizzle-kit v0.31.10 pg pool close issue |
| Adapter boundaries NON-NEGOTIABLE | Pre-flight | Every vendor integration behind port interface from day one |
| Supabase Cloud for alpha (not self-hosted) | Pre-flight | 3-container Docker Compose, zero auth/realtime ops |
| Skills DB → disk materialization | Pre-flight | Harnesses read files; DB is source of truth |
| Sequential phases for solo dev | Pre-flight | 14-week timeline; phases 5+6 can partially overlap |
| Native fetch for GitHub API (no Octokit) | Phase 2, Plan 01 | Minimize alpha dependencies |
| State machine via VALID_TRANSITIONS map | Phase 2, Plan 01 | Simple, explicit, type-safe transitions |
| Hard delete for skills in alpha | Phase 2, Plan 02 | Simplest approach, revisit post-alpha |
| No external CLI dependencies | Phase 2, Plan 03 | process.argv + parseFlag, zero packages |

### Deferred Issues

| Issue | Origin | Effort | Revisit |
|-------|--------|--------|---------|
| drizzle-kit migrate hangs (pg pool close) | Phase 1, Plan 02 | S | Next drizzle-kit update |
| CLI authentication model (PAT vs Supabase session) | Pre-flight | S | Phase 3 or later |
| Supabase Auth middleware containment (not inside adapters/) | Pre-flight | M | Phase 3 |
| Realistic test harness for high-throughput transcript simulation | Pre-flight | M | Phase 4 |
| Node.js subprocess management — Python escape hatch | DA review | M | Phase 6 |
| Supabase Realtime throughput under high-volume streaming | DA review | M | Phase 4 |

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-04-08
Stopped at: Plan 03-01 UNIFY complete
Next action: /paul:plan (Plan 03-02: Routing profiles + provider/model registry)
Resume file: .paul/phases/03-personas-configuration/03-01-SUMMARY.md
Resume context:
- Persona service established — persona lifecycle + inheritance + skill binding
- 03-02 scope: routing profiles CRUD + binding to personas, provider/model registry CRUD
- Schema exists for routingProfile, routingRule, provider, model tables

---
*STATE.md — Updated after every significant action*
