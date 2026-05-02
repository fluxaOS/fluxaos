# FLX-106 Playbook Execution Redesign Session Handoff

Date: 2026-05-02
Operator: Joseph Pierce
Branch at start: `flx-106-pipeline-execution-redesign`
Branch at end: `flx-106-pipeline-execution-redesign` (PR #203 open, not yet merged)
Origin main at end: `7421310`

## Session Boundary

Session-start marker: `session-start-2026-05-02T03-14-00-07-00.md`
(Note: this was a multi-session effort spanning two context windows; the implementation
began in the previous context and was completed here.)

## Scope

This session completed the full FLX-106 implementation: replacing signal-based pipeline
routing with a playbook-driven execution model where skills do only work, the result
document carries facts, and the orchestrator audits and routes. All 16 plan tasks are done.
PR #203 is open on `flx-106-pipeline-execution-redesign` and awaiting merge.

## What Was Built

Sixteen commits on the feature branch covering five phases:

**Phase 1 — Result Document**
- `src/core/pipeline/result-doc.ts` — Zod schema for the JSON blob agents write to
  `$RESULT_DOC_PATH`. Fields: issue/run/org/project context (engine pre-populated),
  `verdict` (`pass`|`fail`|`blocked`), `summary`, optional `comment`, `blockers[]`,
  `artifacts[]`.
- `src/scripts/pipeline/init-result-doc.ts` — reads DB context, writes partial doc with
  context fields; idempotent (won't clobber an existing verdict).
- `src/scripts/pipeline/ingest-result-doc.ts` — reads, fills timing, validates, persists
  to `stage_run.result_doc`; emits JSON to stdout for the orchestrator.
- DB migration: `pipeline.playbook_path`, `pipeline.playbook_scope`, `stage_run.result_doc`.

**Phase 2 — Playbook YAML**
- `src/core/pipeline/playbook.ts` — Zod discriminated union parser for sequential stages
  and parallel groups. Key fix: `z.preprocess` injects `type: 'sequential'` when the
  field is absent (discriminated union needs the key in raw input before defaults apply).
- `src/core/pipeline/playbook-discovery.ts` — three-scope resolution: bundled → org →
  project; project overrides by filename.
- `src/core/pipeline/bundled/standard-dev.yaml` — five-stage pipeline: research →
  implement → review → rework → deploy, with gate rules and `onPass`/`onFail`/`fallback`
  routing.
- `src/core/pipeline/bundled/skills/*.md` — work-only prompts for all five stages.
  Agents write the result doc; they do NOT transition states or post comments directly.

**Phase 3 — Orchestrator Audit Flow**
- `src/core/pipeline/playbook-auditor.ts` — routes result docs through the gate engine.
  `blocked` verdict or non-empty `blockers[]` always routes to fallback regardless of
  other gate results.
- `src/core/pipeline/paperwork-executor.ts` — posts comment, posts blocker summary, then
  transitions issue state via `IssueService`. Special cases: `'complete'` closes the
  issue; `'blocked'` updates status instead of transitioning state.
- `src/core/pipeline/prompt-composer.ts` — `${KEY}` brace-syntax variable substitution.

**Phase 4 — LangGraph Runner**
- `src/core/pipeline/langgraph-stage-runner.ts` — three-node graph: prepare (mkdir +
  init-result-doc) → execute (driver binary) → ingest (ingest-result-doc).
- `src/core/pipeline/checkpoint-store.ts` — lazy `PostgresSaver` singleton with `setup()`
  and `end()`.
- Dependencies added: `@langchain/langgraph@^1.2.9`,
  `@langchain/langgraph-checkpoint-postgres@^1.0.1`, `@types/js-yaml`.

**Phase 5 — Orchestrator Shim**
- `src/core/orchestrator/event-orchestrator.ts` — `launchStage` branches on
  `pipeline.playbookPath`. Old pipelines (`null`) fall through to `executeStageRun`
  unchanged. Parallel group throws `NotImplementedError` (FLX-109 deferred).
- `src/scripts/verify-agnostic-core.ts` — `'complete'` routing sentinel allowlisted
  (FLX-108); `'claude'` hardcoded fallback removed (fail-fast to `PIPELINE_RUN_STATUS.failed`).

**Tests (all green)**
- 10 schema tests (`playbook-result-doc.test.ts`)
- 8 parser tests (`playbook-parser.test.ts`)
- 6 discovery tests (`playbook-discovery.test.ts`)
- 9 auditor tests (`playbook-auditor.test.ts`)
- 2 real-DB paperwork tests (`playbook-paperwork.test.ts`)
- 4 prompt-composer tests (`playbook-prompt-composer.test.ts`)
- 1 LangGraph smoke test (`playbook-langgraph.test.ts`)
- 3 Playwright smoke tests (`e2e/playbook-pipeline-smoke.spec.ts`)

5 pre-existing vitest failures on `main` are unchanged by this PR.

## Open PRs Awaiting Action

- **PR #203** — `feat: playbook-driven pipeline execution (FLX-106)`
  https://github.com/fluxaOS/fluxaos/pull/203
  Status: In Review. Merge when ready; then mark FLX-106 Done and delete branch.

## Deferred Tickets Filed This Session

- **FLX-108** — Replace `'complete'` sentinel in `paperwork-executor.ts` with a typed
  constant exported from the auditor. Currently allowlisted in `verify-agnostic-core.ts`.
- **FLX-109** — Implement parallel group execution. Parser and schema support it; the
  orchestrator throws `NotImplementedError` as a guard.

## Incidents & Root Causes

- **`z.discriminatedUnion` + `.default()`**: discriminated union checks the key in raw
  input before Zod applies defaults. Fix: `z.preprocess` to inject `type: 'sequential'`
  when the field is absent.
- **`'blocked'` is a status, not a state**: `IssueService.getStateByKey('blocked')` throws
  because `blocked` is a status value (open/blocked/in-review), not a pipeline state
  (research/implement/…). Fix: route to `getStatusIdByConfigKey` + `updateStatus` instead.
- **Drizzle migration journal conflict**: a parallel migration `0016_*` already existed;
  the new one collided. Fixed with `npx drizzle-kit push` to sync schema directly.
- **`Annotation<boolean>` type error**: `{ default: () => false }` is not assignable to
  `SingleReducer<boolean, boolean>`. Fix: simplified to `Annotation<boolean>()` (no default).
- **Agnostic-core gate blocked push**: `'claude'` fallback and `'complete'` literal both
  caught on pre-push. Fixed before push.

## Verification

| Check | Result |
|-------|--------|
| TypeScript (`tsc`) | 0 errors |
| Biome | Clean (applied with `--write`) |
| `npx vitest run` (new tests) | All pass in isolation |
| `npx vitest run` (full suite) | 5 pre-existing failures, no regressions |
| `verify-agnostic-core` | PASS |
| Playwright smoke | 3/3 pass |
| Pre-push hook | PASS |
| Human browser sign-off | Not applicable (no UI changes) |

## Current State

- HEAD: `63c1abe` on `flx-106-pipeline-execution-redesign`
- Branch ahead of `origin/main` by 20 commits
- Working tree: clean
- Worktrees: `flx-106-pipeline-execution-redesign` active
- Dev server: running on port 3003

## Files Touched

| File | Change |
|------|--------|
| `src/core/pipeline/result-doc.ts` | Created |
| `src/core/pipeline/playbook.ts` | Created |
| `src/core/pipeline/playbook-discovery.ts` | Created |
| `src/core/pipeline/playbook-auditor.ts` | Created |
| `src/core/pipeline/paperwork-executor.ts` | Created |
| `src/core/pipeline/prompt-composer.ts` | Created |
| `src/core/pipeline/langgraph-stage-runner.ts` | Created |
| `src/core/pipeline/checkpoint-store.ts` | Created |
| `src/core/pipeline/bundled/standard-dev.yaml` | Created |
| `src/core/pipeline/bundled/skills/{research,implement,review,rework,deploy}.md` | Created |
| `src/scripts/pipeline/init-result-doc.ts` | Created |
| `src/scripts/pipeline/ingest-result-doc.ts` | Created |
| `src/core/db/schema.ts` | Added `playbookPath`, `playbookScope`, `resultDoc` columns |
| `src/scripts/db/seed.ts` | Wire Standard Dev pipeline to `standard-dev` playbook |
| `src/core/orchestrator/event-orchestrator.ts` | Added playbook branch in `launchStage` |
| `src/scripts/verify-agnostic-core.ts` | Allowlist `'complete'`; remove `'claude'` fallback |
| `CLAUDE.md` | Added `FLUXAOS_BUNDLED_PIPELINES_DIR` env var, 2 pipeline scripts to command table |
| `package.json` | New deps + `pipeline:init-result-doc` / `pipeline:ingest-result-doc` scripts |
| `e2e/playbook-pipeline-smoke.spec.ts` | Created |
| `src/__tests__/integration/playbook-*.test.ts` (7 files) | Created |
| `docs/superpowers/specs/2026-05-02-pipeline-execution-redesign.md` | Created |
| `docs/superpowers/plans/2026-05-02-pipeline-execution-redesign.md` | Created |
| `docs/superpowers/plans/2026-05-02-flx-106-discovery-notes.md` | Created |
| `drizzle/0016_robust_bill_hollister.sql` | Created (migration) |

## Suggested Next-Session Prompt

```
Continue fluxaOS from the flx-106-pipeline-execution-redesign branch.
PR #203 is open: feat: playbook-driven pipeline execution (FLX-106).
Merge it, mark FLX-106 Done in Linear, delete the branch, and confirm
the repo is clean on main. Then check the roadmap for the next priority.
Key deferred tickets from this session: FLX-108 (typed 'complete' constant),
FLX-109 (parallel group execution).
```
