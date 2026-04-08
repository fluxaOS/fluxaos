# Phase 4 Context: Pipeline Engine

## Goals

1. **Generic config-driven pipeline executor** — the engine reads user configuration and executes it. Stage names, order, gate rules, routing, personas, skills — all defined by the user, not the application. The engine doesn't know what it's running.

2. **Versatile rules engine (MVP-critical)** — a general-purpose rule evaluation system that applies across domains: gates, model selection, provider routing, persona assignment, and anything else. Rules are user-defined, per-project, variable in quantity. One user may have 10 gate rules and 5 model rules; another may have 4 and 2. The engine evaluates whatever rules exist — modular, config-driven, fail fast, no fallbacks.

3. **Strict enforcement** — the engine is opinionated on behalf of the user. If a gate condition isn't met, execution stops. No "best effort," no silent degradation. Fail fast always.

4. **No coupling, no shortcuts** — separate worker process (not co-located), proper adapter interfaces for BullMQ and execution, no hard-coded behavior. Architecture must be right even if it takes 6 months longer.

5. **"Just Do It" mode** — designed, planned, and architecturally decoupled, but does not need to be live for alpha. The interface and flow should exist but can ship incomplete.

## Approach

- Pipeline is a config-driven interpreter: read config -> execute stage -> evaluate rules -> route next
- Rules engine is a first-class module in core, not bolted onto gates. It evaluates rules across any domain (gates, models, providers, personas)
- All state transitions, stage definitions, and gate conditions come from user configuration in DB
- BullMQ stays behind adapter interface; worker runs as separate process
- Adapter boundaries remain non-negotiable (consistent with phases 1-3)
- Event-sourced observability (append-only event store with typed payloads)

## Open Questions

- Rules engine expression language: how complex can rule conditions be? (simple comparisons, or full predicate logic?)
- Rule priority/ordering: when multiple rules match, how are conflicts resolved?
- Pipeline config format: what does the user-facing config schema look like?
- Rework loops: how does the user configure rework conditions and max retries?

## Constraints

- No vendor coupling in core — all external integrations behind port interfaces
- Solo developer — sequential execution, no parallel phase work
- Must integrate with Phase 3 outputs: personas, routing profiles, providers, brands

## From Roadmap

**Plans (tentative):**
- 04-01: Pipeline + StageRun state machine + event store
- 04-02: Routing resolver + gate rules engine
- 04-03: BullMQ + node-exec adapters + skill materialization wire-up
- 04-04: "Just Do It" mode + integration test + CLI extensions

**Exit criteria:** 3-stage pipeline completes E2E in test. Routing, gate evaluation, rework loop, subprocess streaming all work. "Just Do It" mode works via CLI.

---
*Created: 2026-04-08 — from /paul:discuss*
