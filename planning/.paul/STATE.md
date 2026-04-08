# Project State

## Project Reference

See: .paul/PROJECT.md (updated 2026-04-08)

**Core value:** Orchestrate any AI workflow end-to-end with configurable pipelines, provider-agnostic routing, gate-controlled quality, and full observability — no vendor lock-in.
**Current focus:** Phase 5 — Web UI — Core Pages

## Current Position

Milestone: v0.1.0-alpha
Phase: 5 of 7 (Web UI — Core Pages) — Not started
Plan: Ready for 05-01 (Dashboard + issues pages)
Status: Phase 4 complete, ready for next PLAN
Last activity: 2026-04-08 — Phase 4 complete

Progress:
- Milestone: [▓▓▓▓▓▓░░░░] ~57% (4 of 7 phases complete)
- Phase 5: [░░░░░░░░░░] 0% (0 of 3 plans complete)

## Loop Position

Current loop state:
```
PLAN ──▶ APPLY ──▶ UNIFY
  ○        ○        ○     [Ready for Phase 5 PLAN]
```

## Accumulated Context

### Decisions

| Decision | Phase | Impact |
|----------|-------|--------|
| Use central_databases stack (not per-project Docker) | Phase 1, Plan 02 | postgres via pgbouncer on :5432, redis on :6379 with auth; docker-compose.yml stripped |
| Apply migrations via direct SQL (drizzle-kit migrate hangs) | Phase 1, Plan 02 | Workaround for drizzle-kit v0.31.10 pg pool close issue |
| Adapter boundaries NON-NEGOTIABLE | Pre-flight | Every vendor integration behind port interface from day one |
| Supabase Cloud for alpha (not self-hosted) | Pre-flight | Hosted Postgres + auth + realtime, zero ops |
| Skills DB → disk materialization | Pre-flight | Harnesses read files; DB is source of truth |
| Sequential phases for solo dev | Pre-flight | 14-week timeline; phases 5+6 can partially overlap |
| Native fetch for GitHub API (no Octokit) | Phase 2, Plan 01 | Minimize alpha dependencies |
| State machine via VALID_TRANSITIONS map | Phase 2, Plan 01 | Simple, explicit, type-safe transitions |
| Hard delete for skills in alpha | Phase 2, Plan 02 | Simplest approach, revisit post-alpha |
| No external CLI dependencies | Phase 2, Plan 03 | process.argv + parseFlag, zero packages |
| Gate verdict severity: proceed < hold < rework < abort | Phase 4 | Worst verdict wins when multiple rules fail |
| Cost parsing deferred to Phase 6 | Phase 4 | Hardcoded to '0' until real AI providers wired up |

### Deferred Issues

| Issue | Origin | Effort | Revisit |
|-------|--------|--------|---------|
| drizzle-kit migrate hangs (pg pool close) | Phase 1, Plan 02 | S | Next drizzle-kit update |
| CLI authentication model (PAT vs Supabase session) | Pre-flight | S | Phase 5 or later |
| Supabase Auth middleware (not wired into tRPC) | Phase 1 | M | Phase 5 |
| Supabase Realtime adapter (not implemented) | Phase 1 | M | Phase 5 |
| Cost parsing from harness output | Phase 4 | M | Phase 6 |
| Node.js subprocess management — Python escape hatch | DA review | M | Phase 6 |
| Supabase Realtime throughput under high-volume streaming | DA review | M | Phase 5 |

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-04-08
Stopped at: Phase 4 complete, handoff created
Next action: /paul:plan (Plan 05-01: Dashboard + issues pages)
Resume file: .paul/phases/04-pipeline-engine/PHASE-04-SUMMARY.md
Resume context:
- Pipeline engine fully operational — state machine, gates, routing, execution, CLI
- All tRPC endpoints exist for UI consumption (16 pipeline endpoints)
- App shell exists with empty dashboard pages — ready for content
- tRPC client/provider set up in src/lib/trpc/
- Supabase Auth adapter exists but NOT wired into middleware
- Supabase Realtime adapter does NOT exist yet — needed for live transcript

---
*STATE.md — Updated after every significant action*
