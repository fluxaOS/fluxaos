# Archon Feature Analysis — What fluxaOS Should Steal

**Date:** 2026-04-18
**Source:** https://github.com/coleam00/Archon
**Author:** Session analysis (jpierce + Claude)
**Status:** Research — not a plan. Feeds future R4/R5/R6 planning.

---

## Executive Summary

Archon is a more mature sibling that solves many of the same problems fluxaOS is about to solve in R4 (Gate Engine) and R5 (Pipeline Engine). Its workflows live in YAML; fluxaOS's live in Supabase. That difference is non-negotiable — it is the thesis of the rebuild — so **we do not adopt Archon as a dependency**. Instead we mine it as a reference codebase for patterns and content.

Highest-leverage takeaways:

1. **Their 17 workflows are gold.** Port them as seeded pipeline + skill records once R5 lands. This alone justifies the analysis.
2. **Their DAG executor is the reference implementation** for what fluxaOS's `core/pipeline` must become. Study, don't copy — but the node/edge/condition model maps cleanly.
3. **Their `isolation` package (git worktrees + subprocess harness) is a near-drop-in pattern** for our BullMQ worker isolation story.
4. **Their loop/gate primitives (`interactive: true`, `fresh_context`, `<promise>` signals)** expose gaps in fluxaOS's current gate spec — we should absorb these into R4.

Everything else (YAML parser, platform adapters, their storage layer) is lower priority or conflicts with our thesis.

---

## Comparison Baseline

| Axis | Archon | fluxaOS |
|---|---|---|
| **Core thesis** | Workflows as YAML, committed to repo | Workflows as DB records, runtime-editable |
| **Engine knowledge** | Ships 17 named workflows | Agnostic — zero stage literals in core |
| **Storage** | SQLite/Postgres (7 tables) | Supabase Postgres (37 tables) |
| **AI integration** | Claude Code + Codex subprocess | Provider-agnostic via adapter registry |
| **Isolation** | Git worktrees per run | BullMQ workers (worktree story TBD) |
| **UI** | Web + CLI + Slack/Discord/Telegram/GitHub | Web only (Next.js App Router) |
| **Streaming** | Event emitter + platform adapters | Supabase Realtime |
| **Maturity** | Shipping, 17 workflows live | R-INFRA done, R-UI next, engine rebuild ahead |

---

## Feature Inventory — Scored

Each row is scored on four axes:

- **Value**: How much does this accelerate fluxaOS? (1-5)
- **Fit**: How cleanly does it map to our DB-as-config thesis? (1-5)
- **Effort**: How much work to port/adapt? (1=days, 5=months)
- **Phase**: Where in the roadmap it lands

| # | Feature | Value | Fit | Effort | Target Phase | Verdict |
|---|---|---|---|---|---|---|
| 1 | **17 workflow library** (fix-github-issue, piv-loop, smart-pr-review, etc.) | 5 | 5 | 2 | R5 seed / post-R5 | **STEAL** as seed data |
| 2 | **DAG executor pattern** (`packages/workflows/src/dag-executor.ts`) | 5 | 4 | 3 | R5 | **STUDY & ADAPT** — reference for our engine |
| 3 | **Git worktree isolation** (`packages/isolation/`) | 4 | 5 | 2 | R5 | **PORT** — drop-in pattern |
| 4 | **Subprocess harness for Claude Code / Codex** | 4 | 5 | 2 | R5 | **PORT** — we need this anyway |
| 5 | **Loop nodes** (`fresh_context`, max iterations, interactive gates) | 5 | 4 | 3 | R4 or R5 | **ADOPT CONCEPT** — extend our gate/stage model |
| 6 | **`<promise>` signal protocol** (structured completion signals from AI) | 4 | 5 | 1 | R4 | **ADOPT** — extends our skill signal protocol |
| 7 | **Trigger rules** (`one_success`, `all_success` for conditional fan-in) | 4 | 4 | 2 | R5 | **ADOPT** — needed for multi-agent review |
| 8 | **Per-node model assignment** (haiku for classify, opus for implement) | 4 | 5 | 1 | R5 | **ADOPT** — maps to our routing rules |
| 9 | **Resume-from-failure logic** (skip completed nodes on retry) | 4 | 4 | 3 | R5 | **ADOPT** |
| 10 | **Three-tier error classification** (FATAL / UNKNOWN / transient, abort threshold) | 4 | 5 | 2 | R5 | **ADOPT** |
| 11 | **Concurrent run detection** (prevent two runs on same worktree) | 3 | 5 | 1 | R5 | **ADOPT** |
| 12 | **Event emitter for lifecycle** | 3 | 3 | 2 | R5 | **COMPARE** with Supabase Realtime; pick one |
| 13 | **Platform adapters** (Slack/Discord/Telegram/GitHub) | 2 | 3 | 4 | Post-v1 | **DEFER** — web-only for alpha |
| 14 | **Web dashboard with real-time monitoring** | 2 | 2 | 4 | — | **SKIP** — we have our own |
| 15 | **YAML workflow parser** | 1 | 1 | 3 | — | **SKIP** — conflicts with DB thesis |
| 16 | **Their storage layer (7-table SQLite)** | 1 | 1 | 3 | — | **SKIP** — we have 37 tables on Supabase |
| 17 | **Workflow validator** (schema + runtime checks) | 3 | 4 | 2 | R5 | **ADAPT** — validate DB records, not YAML |
| 18 | **Condition evaluator** (for `when:` expressions) | 4 | 5 | 2 | R4 | **ADOPT** — overlaps with gate rule engine |
| 19 | **Artifact bridging** (plan.md → investigation.md for uniform downstream input) | 3 | 4 | 1 | R5 | **ADOPT** — pattern for optional-branch fan-in |
| 20 | **Base branch auto-detection** | 2 | 4 | 1 | R5 | **ADOPT** |

---

## Deep-Dive: The 10 Highest-Value Steals

### 1. Port Archon's 17 Workflows as Seed Data

**What it is.** Archon ships 17 named workflows in `.archon/workflows/defaults/*.yaml`. Examples: `archon-fix-github-issue` (10-phase DAG: classify → investigate → implement → review → self-fix → ship), `archon-piv-loop` (human-in-the-loop Plan/Implement/Validate with interactive gates), `archon-smart-pr-review` (complexity-aware multi-agent review).

**Why it matters.** These are months of real-world iteration on "how do you actually get an AI to fix a bug reliably." Reproducing them from scratch is waste. They map directly onto fluxaOS's `pipeline` + `pipeline_stage` + `skill` + `routing_rule` tables.

**Mapping to fluxaOS tables.**

```
Archon YAML                 →  fluxaOS tables
─────────────────────────────────────────────────
workflow (top-level)        →  pipeline
node                        →  pipeline_stage
node.prompt / command       →  skill (with version)
node.model                  →  routing_rule (per stage)
node.when: expression       →  stage_gate_result rules
node.trigger_rule: one_of   →  pipeline_stage.trigger_rule (new column)
node.context: fresh         →  pipeline_stage.context_mode (new column)
node.loop + interactive     →  pipeline_stage.loop_config (jsonb)
```

**Action.** After R5 lands and the engine is proven, write a one-shot importer: parse their YAMLs, emit seed SQL that creates equivalent `pipeline` / `pipeline_stage` / `skill` records. Commit as `src/core/db/seed/archon-workflows.ts`.

**Risk.** Their YAML references Claude Code specifically. Our harness layer needs to abstract that — but that abstraction is already our design goal.

---

### 2. DAG Executor as Reference

**What it is.** `packages/workflows/src/dag-executor.ts` + `executor.ts` + `condition-evaluator.ts`. A battle-tested topological executor with:

- Resume-from-failure (skip completed nodes)
- Three-tier error classification (FATAL rethrow / UNKNOWN with abort-after-3 / transient suppress)
- Concurrent-run detection (same worktree lockout)
- Conditional node firing via `when:` expressions
- Trigger rules (`one_success`, `all_success`) for fan-in

**Why it matters.** fluxaOS R5 will build exactly this. Their executor is ~1 file, readable, and has the edge cases already surfaced (resume, transient errors, abort threshold).

**Action.** During R5 planning, read `executor.ts` and `dag-executor.ts` cover-to-cover. Lift the patterns — not the code — into a TS file under `src/core/pipeline/executor.ts`. Our version reads nodes from the DB instead of a parsed YAML.

**Do not copy the code directly.** Licensing aside (MIT-compatible but still), their code assumes YAML parse trees and their own storage shape. Our inputs are Drizzle rows. But the *shape* of the executor is reusable.

---

### 3. Git Worktree Isolation

**What it is.** `packages/isolation/src/` exports `WorktreeProvider`, `IsolationResolver`, `getPrState`, and worktree file helpers. Each workflow run gets a dedicated git worktree so parallel runs don't stomp each other.

**Why it matters.** fluxaOS's current worker story is BullMQ-only. We haven't solved "two AI workers fixing different issues in the same repo at once." Worktrees are the standard answer and they already built it.

**Mapping to fluxaOS.**

```
Archon                     →  fluxaOS
────────────────────────────────────────
WorktreeProvider           →  src/adapters/git/worktree-provider.ts
IsolationResolver          →  src/core/orchestrator/isolation.ts
IsolationBlockedError      →  src/core/errors/isolation.ts
```

**Action.** When R5 adds real pipeline execution, include a `WorktreeProvider` port and Git adapter. The BullMQ worker acquires a worktree before invoking the harness. Deferred if single-worker is acceptable for alpha.

---

### 4. Subprocess Harness for Claude Code + Codex

**What it is.** Archon invokes AI models by spawning Claude Code and Codex CLI subprocesses, reading their stdout as event streams, and parsing structured outputs.

**Why it matters.** R5 needs exactly this. The fluxaOS spec calls for "real AI provider execution (claude-code subprocess)." Their harness is a working reference for:

- Process lifecycle (spawn, pipe stdout/stderr, handle signals)
- Idle timeout enforcement (600s in their PIV loop)
- Output parsing (extract `<promise>` signals, tool calls, cost lines)
- Error surface mapping (subprocess exit codes → our error taxonomy)

**Action.** During R5, study their subprocess invocation before writing ours. Fold into `src/adapters/subprocess/claude-code-harness.ts` and `codex-harness.ts`.

---

### 5. Loop Nodes with `fresh_context` + Interactive Gates

**What it is.** Archon workflows can mark nodes as loops with:

```yaml
loop:
  max_iterations: 15
  interactive: true        # pause for human before advancing
  context: fresh           # new AI session per iteration
  condition: ALL_TASKS_COMPLETE
  idle_timeout: 600
```

This is how `archon-piv-loop` implements "Plan-Implement-Validate with human checkpoints."

**Why it matters.** fluxaOS's current gate spec (R4) has `auto / rules / hold` modes but no concept of *iterative* stages with bounded retries and context policy. Most real AI workflows are iterative. Shipping R4 without this will force an immediate R4.5.

**Mapping to fluxaOS.** Add a `loop_config` jsonb column to `pipeline_stage`:

```ts
loopConfig: {
  maxIterations: number
  interactive: boolean     // pauses for human input
  contextMode: 'fresh' | 'continue'
  exitCondition: string    // rule expression evaluated per iteration
  idleTimeoutSec: number
}
```

**Action.** Fold into R4 plan. This is the single biggest gap in our current gate spec.

---

### 6. `<promise>` Signal Protocol

**What it is.** Archon AI nodes emit structured tags in their output like `<promise>PLAN_APPROVED</promise>` or `<promise>COMPLETE</promise>`. The executor scans for these to determine when a loop/stage should advance. Prevents premature advancement from ambiguous AI output.

**Why it matters.** fluxaOS already has the "skill signal protocol" concept (see `docs/issue-lifecycle.md`). Archon's version is more concrete and battle-tested. We should adopt their exact tag syntax so imported Archon workflows work unchanged.

**Action.** In R4, specify `<promise>SIGNAL_NAME</promise>` as the canonical signal format. Extend the skill signal protocol doc.

---

### 7. Trigger Rules (`one_success`, `all_success`)

**What it is.** When multiple upstream nodes feed into one downstream node, how does it decide to fire? Archon's options:

- `all_success` (default) — wait for every upstream
- `one_success` — fire if any upstream completes (others may be skipped via `when:`)

Critical for fan-in patterns like "investigate OR plan → bridge-artifacts" where only one path runs.

**Why it matters.** Without this, our DAG can't express conditional branches cleanly. Current schema has no column for this.

**Action.** Add `triggerRule: 'all_success' | 'one_success'` to `pipeline_stage`. Schedule for R5.

---

### 8. Per-Node Model Assignment

**What it is.** Archon assigns models per-node:
- Haiku for cheap classification nodes
- Sonnet default
- Opus 4.6 for heavy implementation

**Why it matters.** Massive cost savings. fluxaOS already has `routing_rule` tables — this just needs the convention of "stages declare a default routing rule, which picks the model." Already supported by the schema. Just need to codify the pattern and document it.

**Action.** Seed data convention: every `pipeline_stage` row points to a `routing_profile` that resolves to an appropriate `model`. Document in the stage-author guide once we have one.

---

### 9. Resume-from-Failure

**What it is.** If a pipeline run fails, the next run on the same worktree detects completed nodes and resumes from the first incomplete one. "AI session context from prior nodes is not restored. Nodes that depend on prior context may need to re-read artifacts."

**Why it matters.** Cheap debugging iteration. Today a failed fluxaOS run would have to re-run from the top.

**Mapping.** Our `pipeline_run` + `stage_run` tables already record status. Resume logic is executor-side: on start, query last run's stage_runs, skip completed ones, start from first non-completed.

**Action.** Include in R5 executor design.

---

### 10. Three-Tier Error Classification

**What it is.** Archon classifies runtime errors into FATAL (config issue, rethrow), UNKNOWN (track count, abort after 3 consecutive), transient (swallow and continue). Prevents one flaky network call from tanking an hour-long run.

**Why it matters.** Our current orchestrator has no error taxonomy. Any error kills the run.

**Action.** Define `src/core/errors/classification.ts` during R5. Executor uses it to decide retry vs abort.

---

## What to Explicitly Skip

| Feature | Why Skip |
|---|---|
| **YAML workflow format** | Kills the DB-as-config thesis. This is the whole point of fluxaOS. |
| **Archon storage layer** | Their 7 tables are a subset of our 37. Porting to their shape is regression. |
| **Archon orchestrator service** | Tightly coupled to their storage + YAML; easier to read than refactor. |
| **Platform adapters (Slack/Discord/Telegram)** | Web UI is enough for alpha. Revisit post-v1 if users ask. |
| **Their web dashboard** | We have an approved mockup. Our dashboard wins. |
| **Their auth-service** | Supabase Auth is already wired. |

---

## Integration Plan — When to Do What

### During R4 (Gate Engine)
- [ ] Adopt `<promise>SIGNAL</promise>` tag format as canonical skill-signal protocol
- [ ] Extend `pipeline_stage` with `loop_config` jsonb column
- [ ] Design condition evaluator against their `condition-evaluator.ts` as reference
- [ ] Update `docs/issue-lifecycle.md` skill-signal section to match

### During R5 (Pipeline Engine)
- [ ] Read `dag-executor.ts` + `executor.ts` before writing ours
- [ ] Add `triggerRule` column to `pipeline_stage`
- [ ] Add `contextMode` column to `pipeline_stage`
- [ ] Implement three-tier error classification
- [ ] Implement resume-from-failure using existing run tables
- [ ] Study `packages/isolation/` and design worktree provider port
- [ ] Study their subprocess harness before writing Claude Code / Codex adapters

### Post-R5 (Before v0.1.0-alpha)
- [ ] Write Archon YAML → fluxaOS seed-data importer (one-shot script)
- [ ] Seed 3-5 flagship workflows: `fix-github-issue`, `piv-loop`, `smart-pr-review`
- [ ] Validate each against real Supabase + running engine
- [ ] Port remaining 12 workflows as time permits

### Deferred (v0.2+)
- [ ] Platform adapters (Slack/Discord/Telegram) if user demand materializes

---

## Risks & Open Questions

1. **License.** Archon is MIT-licensed (verify before copying any code). Pattern adoption is always safe; code copy requires attribution.
2. **YAML vs DB drift.** Their workflows evolve upstream. Our imported copies will drift. Accept this: treat the import as a one-shot, not an ongoing sync.
3. **Harness coupling.** Their workflows assume Claude Code CLI. If we want Codex or other harnesses, the imported seed data needs a harness-abstraction pass.
4. **Loop semantics.** Their loops + interactive gates are powerful but push complexity into the gate engine. Need to decide R4 scope carefully — implementing loops late is painful.
5. **Worktree story.** Adding worktrees to BullMQ workers may require rethinking the worker lifecycle. Single-worker-no-worktree is a valid alpha scope.

---

## Bottom Line

Archon is **not a dependency candidate** but is **the most valuable reference codebase we have**. The 17 workflows alone, when seeded into fluxaOS, give us an instant content library that would otherwise take 3-6 months to build. The DAG executor, worktree isolation, and subprocess harness give us reference implementations for the three hardest parts of R5.

Recommendation: read their code, copy their patterns, import their workflows, ship our engine. Budget ~1 week of study time across R4 and R5 planning phases.

---

## Appendix A — File Map for Study

Priority reading order when R4/R5 planning starts:

| File | Why |
|---|---|
| `packages/workflows/src/executor.ts` | Top-level orchestration, resume, error handling |
| `packages/workflows/src/dag-executor.ts` | Topological execution logic |
| `packages/workflows/src/condition-evaluator.ts` | `when:` expression evaluation |
| `packages/workflows/src/schemas/workflow.ts` | Data shape for workflows |
| `packages/workflows/src/schemas/dag-node.ts` | Node schema — maps to our pipeline_stage |
| `packages/workflows/src/schemas/loop.ts` | Loop config — gap in our current schema |
| `packages/isolation/src/index.ts` | Worktree provider API |
| `.archon/workflows/defaults/archon-piv-loop.yaml` | Interactive-gate reference workflow |
| `.archon/workflows/defaults/archon-fix-github-issue.yaml` | Complex DAG reference workflow |
| `.archon/workflows/defaults/archon-smart-pr-review.yaml` | Parallel fan-out reference workflow |

## Appendix B — Schema Extensions Implied by This Analysis

New columns on `pipeline_stage`:

```sql
ALTER TABLE pipeline_stage
  ADD COLUMN trigger_rule text DEFAULT 'all_success',  -- 'all_success' | 'one_success'
  ADD COLUMN context_mode text DEFAULT 'continue',      -- 'continue' | 'fresh'
  ADD COLUMN loop_config jsonb;                         -- { maxIterations, interactive, exitCondition, idleTimeoutSec }
```

These are additive and backwards-compatible with the R1-R3 schema already shipped.
