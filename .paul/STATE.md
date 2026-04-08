# Project State

## Project Reference

See: .paul/PROJECT.md (updated 2026-04-08)

**Core value:** Orchestrate any AI workflow end-to-end with configurable pipelines, provider-agnostic routing, gate-controlled quality, and full observability — no vendor lock-in.
**Current focus:** Phase 7 — Observability, Polish & Ship

## Current Position

Milestone: v0.1.0-alpha
Phase: 7 of 7 (Observability, Polish & Ship) — Not started
Plan: None yet
Status: Phase 6 complete, ready to begin Phase 7
Last activity: 2026-04-08 — Phase 6 complete (AI adapters, prompt assembly, cost parsing, fallback)

Progress:
- Milestone: [▓▓▓▓▓▓▓▓░░] ~86% (6 of 7 phases complete)
- Phase 7: [░░░░░░░░░░] 0%

## Loop Position

Current loop state:
```
PLAN ──▶ APPLY ──▶ UNIFY
  ○        ○        ○     [New phase — needs PLAN]
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
| Polling over Supabase Realtime for live UI data | Phase 5 | React Query refetchInterval; swap to Realtime in Phase 6/7 |
| Hardcoded first org/project context for alpha | Phase 5 | Single-user assumption; every page loads first org → first project |
| No component library (Tailwind only) | Phase 5 | Zero new UI dependencies for alpha |
| Hardcoded cost rates per model | Phase 6 | Anthropic/OpenAI rates hardcoded; DB rates may not be populated |
| Prompt via FLUXAOS_PROMPT env var | Phase 6 | Simplest mechanism; may hit env size limits for long prompts |
| resolveRoutes() returns ranked list for fallback | Phase 6 | Worker tries each candidate in order |

### Deferred Issues

| Issue | Origin | Effort | Revisit |
|-------|--------|--------|---------|
| drizzle-kit migrate hangs (pg pool close) | Phase 1, Plan 02 | S | Next drizzle-kit update |
| CLI authentication model (PAT vs Supabase session) | Pre-flight | S | Phase 3 or later |
| Supabase Auth middleware containment (not inside adapters/) | Pre-flight | M | Phase 3 |
| Node.js subprocess management — Python escape hatch | DA review | M | Phase 6 |
| Replace polling with Supabase Realtime for run detail page | Phase 5 | S | Phase 7 |
| FLUXAOS_PROMPT env var size limit for large prompts | Phase 6 | S | Post-alpha (use temp file) |

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-04-08
Stopped at: Phase 6 fully complete
Next action: /paul:discuss (Phase 7: Observability, Polish & Ship)
Resume file: .paul/handoffs/HANDOFF-2026-04-08-phase6.md
Resume context:
- Phase 6 delivered: Anthropic + OpenAI AIProvider adapters, GitHub GitProvider, prompt assembler, cost parser, provider fallback
- Phase 7 scope: KPI dashboard, Docker Compose hardening, README, E2E tests, GitHub release
- ROADMAP flags research unlikely

---
*STATE.md — Updated after every significant action*
