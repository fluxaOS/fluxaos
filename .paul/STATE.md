# Project State

## Project Reference

See: .paul/PROJECT.md (updated 2026-04-08)

**Core value:** Orchestrate any AI workflow end-to-end with configurable pipelines, provider-agnostic routing, gate-controlled quality, and full observability — no vendor lock-in.
**Current focus:** Phase 8 — Ship Alpha

## Current Position

Milestone: v0.1.0-alpha
Phase: 8 (Ship Alpha) — Not started
Plan: None yet
Status: Phase 7 partially complete, ready to begin Phase 8
Last activity: 2026-04-08 — Phase 7 partial (KPI dashboard, Docker Compose, README, license, tests)

Progress:
- Milestone: [▓▓▓▓▓▓▓▓▓░] ~90% (7 of 8 phases, Phase 7 partial)
- Phase 8: [░░░░░░░░░░] 0%

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
| Polling over Supabase Realtime for live UI data | Phase 5 | React Query refetchInterval; swap to Realtime post-alpha |
| Hardcoded first org/project context for alpha | Phase 5 | Single-user assumption; every page loads first org → first project |
| No component library (Tailwind only) | Phase 5 | Zero new UI dependencies for alpha |
| Hardcoded cost rates per model | Phase 6 | Anthropic/OpenAI rates hardcoded; DB rates may not be populated |
| Prompt via FLUXAOS_PROMPT env var | Phase 6 | Simplest mechanism; may hit env size limits for long prompts |
| resolveRoutes() returns ranked list for fallback | Phase 6 | Worker tries each candidate in order |
| `.gitignore` exception for `.env.example` | Phase 7 | `.env*` glob was blocking template; `!.env.example` added |
| Mock DB in prompt-assembler tests | Phase 7 | Fast isolated tests; no test DB dependency |
| Phase 7 partial → Phase 8 split | Phase 7 | E2E, seed data, bug sweep, release deferred to dedicated session |

### Deferred Issues

| Issue | Origin | Effort | Revisit |
|-------|--------|--------|---------|
| drizzle-kit migrate hangs (pg pool close) | Phase 1, Plan 02 | S | Next drizzle-kit update |
| CLI authentication model (PAT vs Supabase session) | Pre-flight | S | Post-alpha |
| Supabase Auth middleware containment (not inside adapters/) | Pre-flight | M | Post-alpha |
| Node.js subprocess management — Python escape hatch | DA review | M | Post-alpha |
| Replace polling with Supabase Realtime for run detail page | Phase 5 | S | Phase 8 or post-alpha |
| FLUXAOS_PROMPT env var size limit for large prompts | Phase 6 | S | Post-alpha (use temp file) |
| website/ marketing components missing (header/footer) | Phase 7 CI | S | Phase 8 (08-01) |

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-04-08
Stopped at: Phase 7 partially complete (KPI dashboard, Docker Compose, README, license, tests delivered; E2E tests, seed data, bug sweep, release remain)
Next action: /paul:plan (Phase 8: Ship Alpha)
Resume file: .paul/handoffs/HANDOFF-2026-04-08-phase7.md
Resume context:
- Phase 7 delivered: KPI dashboard, Docker Compose hardening (3 services), README rewrite, AGPLv3 license, cost-parser + prompt-assembler tests (95/95 passing)
- Phase 8 scope: CI fix (website/ errors), E2E tests, seed data + .github/ templates, bug sweep + v0.1.0-alpha release
- CI currently fails on website/ pre-existing issues (Biome format + missing marketing components)
- PR #9 merged to main

---
*STATE.md — Updated after every significant action*
