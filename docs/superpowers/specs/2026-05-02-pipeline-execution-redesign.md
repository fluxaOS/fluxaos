# Pipeline Execution Redesign

Date: 2026-05-02
Status: Draft
Linear: FLX-106 (reopened — development gap)

## Problem Statement

fluxaOS was built as a PAT replacement but the PAT skills did far more than
their names implied. Each skill (research, implement, review, rework, deploy)
was a lifecycle orchestrator: it transitioned issue states, filed blocker
tickets, managed worktrees, wrote issue comments, passed context to the next
stage, and routed conditionally based on outcome. When those skills were ported
to fluxaOS as DB-backed prompt text, the lifecycle orchestration was dropped.
The engine absorbed some of it (gate routing, worktree release at terminal hook)
but not all, and the seams between what the agent owns and what the engine owns
were never made explicit.

The result: the current Standard Dev pipeline seed is not safe for dogfooding.
The skill prompts contain lifecycle instructions the agent cannot reliably
execute through the current flux API, and the engine routing is hardcoded
rather than user-configurable.

## Core Design Principle

> **Own the orchestration logic. Borrow the execution infrastructure.**

fluxaOS owns: playbook schema, gate engine, audit logic, issue lifecycle
paperwork, AI driver abstraction.

Borrowed infrastructure: LangGraph for stage execution checkpointing and
parallel coordination; Supabase for persistence, auth, realtime.

## Mental Model

```
Playbook (YAML)        — what the pipeline looks like, who runs what, how to route
Skill (prompt)         — what the agent does inside one stage, nothing else
Result Document (JSON) — what the agent reports: facts only, no routing decisions
Orchestrator           — auditor: did I get a valid result? what do the rules say?
Gate Engine            — router: given these facts, which path do we take?
LangGraph              — executor: run the stage, checkpoint it, heal it if it crashes
```

The agent is the source of truth for **what happened**.
The orchestrator is the source of truth for **what happens next**.
The agent never transitions issue state, files tickets, or calls the issue API.
The orchestrator executes all paperwork after reading the result document.

## Layered Architecture

```
┌─────────────────────────────────────────────┐
│              fluxaOS Web UI                 │
│   Pipeline list · Playbook editor (Monaco)  │
│   Run dashboard · Gate results · Activity   │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│              Orchestrator (Auditor)          │
│  Reads playbook → resolves stage sequence   │
│  Receives result doc → validates it         │
│  Runs gate engine → gets route              │
│  Executes paperwork → transitions, comments │
│  Hands off to LangGraph stage executor      │
└──────────┬──────────────────────┬───────────┘
           │                      │
┌──────────▼──────────┐  ┌───────▼───────────┐
│    Gate Engine      │  │  LangGraph Runner  │
│  Pure rule eval     │  │  prepare → execute │
│  Context: result    │  │  → ingest          │
│  doc fields         │  │  Checkpointed via  │
│  Returns: route     │  │  PostgresSaver     │
└─────────────────────┘  └───────────────────┘
```

## Playbook Schema

Each pipeline has one YAML playbook file. YAML front matter declares the
pipeline configuration. The markdown body is the base system prompt injected
into every stage run — it gives the agent context about fluxaOS conventions,
the result document contract, and its autonomy rules. Skills are per-stage
prompts that extend the base prompt with stage-specific work instructions.

### File Location and Scope Precedence

Three-scope discovery, higher scope wins (project overrides org, org overrides
bundled):

```
1. Bundled   — shipped with fluxaOS install, read-only defaults
2. Org       — stored per-org, applies to all projects in the org
3. Project   — .fluxaos/pipelines/<name>.yaml in the target repo
```

The web UI lists all pipelines across all three scopes. Bundled pipelines can
be copied to org or project scope for customization. Org and project pipelines
are editable in the Monaco-based web editor. Saving writes the file directly —
the file is the source of truth, not a DB copy.

### Playbook YAML Structure

```yaml
name: standard-dev
description: Research → implement → review → deploy with conditional rework.

# Base system prompt injected into every stage run.
# Skills extend this with stage-specific work instructions.
prompt: |
  You are a fluxaOS pipeline agent running in headless, unattended mode.

  Your only job is to do the work your skill describes and produce an honest
  result document at $RESULT_DOC_PATH when you finish.

  You do not transition issue states. You do not file tickets. You do not
  write comments to the issue. The orchestrator handles all of that after
  reading your result document.

  Result document fields you must write:
  - verdict: "pass" or "fail"
  - summary: one sentence describing what happened and why
  - comment: (optional) text to post as an issue comment
  - blockers: (optional) array of {title, description} for issues to file
  - artifacts: (optional) array of artifact filenames you produced

  The context fields (issue, run, org, project, timing) are pre-populated
  by the engine. Do not overwrite them.

stages:
  - id: research
    skill: research
    onPass: implement        # issue state to transition to on pass
    onFail: research         # stay in research, retry
    fallback: blocked        # no rules matched or no result doc → hold
    rules: []                # no gate rules — trust the agent verdict

  - id: implement
    skill: implement
    onPass: review
    onFail: rework
    fallback: blocked
    rules:
      - field: meta.duration_sec
        operator: less_than
        value: 7200
        severity: warn
        onFail: hold         # took more than 2 hours → human review
        label: Implementation time cap

  - id: review
    skill: review
    onPass: deploy
    onFail: rework
    fallback: blocked        # ambiguous review outcome → human
    rules: []

  - id: rework
    skill: rework
    onPass: review           # rework routes back to review, not forward
    onFail: blocked
    fallback: blocked
    rules:
      - field: run.attempt
        operator: greater_than
        value: 3
        severity: block
        onFail: blocked      # more than 3 rework attempts → escalate
        label: Rework attempt cap

  - id: deploy
    skill: deploy
    onPass: complete         # close the issue
    onFail: blocked
    fallback: complete       # end of pipeline — ambiguity is fine, close it
    rules: []
```

### Per-Stage Fields

| Field | Required | Description |
|---|---|---|
| `id` | yes | Stage identifier, must be unique in the pipeline |
| `skill` | yes | Skill name — resolved from the same three-scope discovery |
| `onPass` | yes | Issue state to transition to when verdict is pass |
| `onFail` | yes | Issue state to transition to when verdict is fail |
| `fallback` | yes | Issue state when no rules match or result doc is invalid |
| `rules` | no | Gate rules (same schema as existing gate engine RuleGroup) |
| `parallel` | no | Array of stage IDs to run concurrently (fan-out, waits for all) |
| `trustMode` | no | `prescriptive` (default) or `declarative` — see Gate section |

### Single-Stage Pipeline (Symphony-style)

A pipeline with one stage where the skill owns the full lifecycle:

```yaml
name: quick-task
description: Single-stage autonomous task runner.

prompt: |
  You are a fluxaOS pipeline agent. Do the work. Report results.

stages:
  - id: run
    skill: my-task
    onPass: complete
    onFail: complete
    fallback: complete
```

The engine treats this identically to a five-stage pipeline. One stage, one
LangGraph execution, one result document audit.

## Result Document Schema

Written to `$RESULT_DOC_PATH` (env var injected by engine before agent starts).
The engine pre-populates context fields. The agent writes work fields.

```json
{
  "issue": {
    "id": "uuid",
    "number": 42,
    "title": "Fix realtime subscription leak"
  },
  "run": {
    "pipelineRunId": "uuid",
    "stageRunId": "uuid",
    "stage": "implement",
    "attempt": 1
  },
  "org": {
    "id": "uuid",
    "slug": "rebos"
  },
  "project": {
    "id": "uuid",
    "slug": "fluxaos"
  },
  "timing": {
    "startedAt": "2026-05-02T03:14:00-07:00",
    "endedAt": "2026-05-02T03:16:22-07:00",
    "duration_sec": 142
  },
  "verdict": "pass",
  "summary": "Implementation complete. All tests pass. PR #47 opened.",
  "comment": "Implemented the fix in src/core/realtime. Added integration test. Ready for review.",
  "blockers": [],
  "artifacts": [
    "implementation-summary.md"
  ],
  "meta": {
    "model": "claude-sonnet-4-6",
    "input_tokens": 12400,
    "output_tokens": 3200
  }
}
```

### Field Rules

**Pre-populated by engine (agent must not overwrite):**
`issue`, `run`, `org`, `project`, `timing.startedAt`

**Written by agent (required):**
`verdict` — `"pass"` or `"fail"` only
`summary` — one sentence, required

**Written by agent (optional):**
`comment` — posted to the issue by the engine after the run
`blockers[]` — engine files one new issue per entry, links as blockers, routes to fallback
`artifacts[]` — filenames relative to `$ARTIFACTS_DIR`, made available to next stage
`meta` — model, token counts; engine fills gaps from driver config if missing
`timing.endedAt` and `timing.duration_sec` — engine writes these after session ends

**Invalid result document** (missing, malformed, missing required fields) is
treated as `fail` verdict. Fallback state applies. The raw file is preserved
for debugging.

### Pre-Population Script

Before starting the agent, the engine runs:

```bash
tsx src/scripts/pipeline/init-result-doc.ts \
  --stage-run-id <uuid> \
  --output $RESULT_DOC_PATH
```

Reads from DB, writes the context fields to the result doc file. Agent finds
the file already partially populated when it starts.

### Ingest Script

After the agent session ends, the engine runs:

```bash
tsx src/scripts/pipeline/ingest-result-doc.ts \
  --stage-run-id <uuid> \
  --result-doc $RESULT_DOC_PATH
```

Validates the result doc, fills `timing.endedAt` and `duration_sec`, fills
missing `meta` fields from driver config, writes the complete record to DB,
returns the validated document to the orchestrator for audit.

## Orchestrator Audit Flow

```
1. Stage run session ends
2. Ingest script runs → validates result doc → writes to DB
3. Orchestrator receives validated result doc

4. AUDIT:
   Is result doc valid?
   └─ No → apply fallback state, post generic comment, stop
   └─ Yes → continue

5. Are there blockers[]?
   └─ Yes → file each as a new issue, link as blocker, apply fallback state, stop
   └─ No → continue

6. Post comment to issue (if comment field present)

7. Run gate engine against result doc as context object
   Rules reference dot-path fields: verdict, meta.duration_sec, run.attempt, etc.

8. Did any rules match?
   └─ No rules configured → use verdict directly (pass → onPass, fail → onFail)
   └─ Rules matched → use worst-action route from gate engine result

9. Transition issue to target state (onPass / onFail / fallback)

10. Pass artifacts[] to next stage environment

11. Launch next stage (if target state maps to a stage in the playbook)
    or terminate pipeline (if target state is terminal)
```

## Gate Engine Integration

The existing gate engine is unchanged. The result document becomes the context
object passed to `evaluateGate()`. Rules use dot-path field references:

```yaml
rules:
  - field: verdict           # "pass" or "fail"
  - field: run.attempt       # retry count
  - field: meta.duration_sec # how long the stage took
  - field: blockers          # array length check via exists/not_equals
  - field: meta.output_tokens # token usage gate
```

### Trust Mode

Configured per-stage in the playbook. Controls how the orchestrator uses the
agent's verdict when no rules match.

**`prescriptive` (default):** Agent verdict is authoritative when no rules
match. Pass → onPass, fail → onFail. Gate rules can override.

**`declarative`:** Agent verdict is evidence only. Rules must explicitly check
the `verdict` field to use it. If no rule references `verdict`, the agent's
self-assessment has no effect on routing.

Prescriptive is right for most stages. Declarative is right for high-stakes
stages where you want the rules to be the sole authority regardless of what
the agent thinks.

## LangGraph Integration

LangGraph is used as the stage execution layer only. The orchestrator remains
the routing brain. LangGraph handles checkpointing, self-healing, and parallel
stage coordination.

### Stage Execution Graph

Every stage run compiles to the same three-node LangGraph graph:

```
prepare → execute → ingest
```

**prepare:** Runs init-result-doc script. Sets up $ARTIFACTS_DIR.
Injects environment variables for the agent.

**execute:** Spawns the AI driver subprocess with the composed prompt
(base prompt + skill prompt). Streams stdout. Writes live output to DB.

**ingest:** Runs ingest-result-doc script. Validates result doc.
Returns validated document to orchestrator.

Each node is checkpointed via `PostgresSaver` (Supabase Postgres — no new
infrastructure). A crash at any node resumes from the last checkpoint:

- Crash during `prepare` → reruns prepare, agent not yet started
- Crash during `execute` → resumes agent session if driver supports it,
  or re-runs the full agent (result doc may be partial — ingest handles this)
- Crash during `ingest` → reruns ingest only, agent output preserved

### Parallel Stage Execution

Stages with `parallel: [stageId, stageId]` in the playbook compile to a
LangGraph superstep — all listed stages run concurrently. LangGraph
coordinates the fan-out and fan-in. The orchestrator waits for all results
before running the gate engine on the combined output.

Example — parallel review. All three stages are declared at the top level.
The `parallel` field on `review` references the IDs of stages that run
concurrently with it. The orchestrator fans out, waits for all to complete,
then audits all three result documents before routing:

```yaml
stages:
  - id: review
    skill: review
    parallel: [test-coverage, security-scan]
    onPass: deploy
    onFail: rework
    fallback: blocked

  - id: test-coverage
    skill: test-coverage
    onPass: _parallel_complete   # special: signals fan-in, not a pipeline route
    onFail: _parallel_complete
    fallback: _parallel_complete

  - id: security-scan
    skill: security-scan
    onPass: _parallel_complete
    onFail: _parallel_complete
    fallback: _parallel_complete
```

All three run simultaneously. LangGraph checkpoints each independently.
If security-scan fails and the others pass, only security-scan reruns on
resume — test-coverage and review results are preserved in the checkpoint.

### PostgresSaver Configuration

LangGraph checkpoint saver uses the existing Supabase Postgres connection.
No new database or infrastructure required. Checkpoint tables are managed by
LangGraph's migration utilities.

## Skill Schema

Skills are simple prompt files. No lifecycle instructions. No state transition
instructions. No API calls.

Three-scope discovery — same as playbooks (bundled → org → project).

```
.fluxaos/skills/<name>.md      # project scope
```

File format:

```markdown
---
name: implement
description: Make the scoped code changes and leave the branch ready for review.
---

## Your Work

Read $ARTIFACTS_DIR/research-findings.md if it exists.

Make the implementation changes described in the issue.

Write $ARTIFACTS_DIR/implementation-summary.md when done.

## You Are Done When

- All relevant tests pass
- Lint is clean
- Implementation summary is written
- Result document verdict is set to pass or fail

## You Do Not Do

- Merge PRs
- Deploy to production
- Close or transition issues
- File tickets
```

The base prompt (from the playbook) handles the autonomy contract and result
document instructions. The skill handles the work.

## Paperwork Execution

All paperwork is executed by the orchestrator after reading the result document.
The agent never calls any of these APIs directly.

| Paperwork | Trigger | Engine action |
|---|---|---|
| Post comment | `result.comment` is present | `issueService.comment.create()` |
| File blocker issues | `result.blockers[]` is non-empty | `issueService.create()` per entry + link as blocker |
| Transition issue state | Always | `issueService.transition()` to onPass/onFail/fallback |
| Pass artifacts | Always | Copy `result.artifacts[]` to next stage `$ARTIFACTS_DIR` |
| Record run metadata | Always | Write full result doc to `stage_run` DB record |
| Release worktree | Terminal stage or abort | `isolationProvider.release()` |
| Close issue | `onPass` maps to terminal state | `issueService.close()` |

## DB Schema Changes

The pipeline/stage CRUD tables (`pipeline`, `pipelineStage`) become runtime
tables only — they store pipeline run state, not pipeline configuration.
Configuration moves to the YAML playbook files.

**Tables that survive unchanged:**
- `pipeline_run` — runtime execution record
- `stage_run` — runtime stage execution record, gains `resultDoc` jsonb column
- `issue_event` — activity feed
- `gate_result` — gate evaluation record

**Tables that change:**
- `pipeline` — loses config columns (stages, gate rules). Gains `playbookPath`
  and `playbookScope` (bundled/org/project).
- `pipeline_stage` — becomes a read-only view derived from the playbook file
  at runtime. No longer source of truth for stage config.

**Tables removed:**
- Stage-level `gateMode`, `gateRules`, `sortOrder`, `driverId`, `skillId`
  columns move to the playbook YAML. DB no longer stores these.

## Migration Strategy

The existing orchestrator and DB-configured pipelines continue to work during
transition. New pipelines use the playbook model. Migration is per-pipeline:

1. Export existing DB pipeline config to playbook YAML (migration script)
2. Point pipeline record at the YAML file
3. Orchestrator detects `playbookPath` and uses new execution path
4. Old code path removed once all pipelines are migrated

No big-bang rewrite. The boundary is the pipeline record — old pipelines run
old code, new pipelines run new code.

## What This Fixes From The FLX-106 Audit

| Audit finding | Fix |
|---|---|
| Stage agents can't reliably write issue comments | Engine posts `result.comment` — agent never calls API |
| `flux:signal` has no generic success target-state | `onPass` in playbook is the target state |
| Deploy completion doesn't close the issue | `onPass: complete` on deploy stage closes it |
| Reopen/return-to-research not first-class | `onFail: research` on implement stage |
| Review can't atomically attach findings and transition | Engine reads `result.comment` + transitions in one audit pass |
| No `pat pipeline exit` equivalent | Result document is the structured exit contract |
| PR/branch metadata not given to skills | `$ARTIFACTS_DIR` inheritance passes it forward |
| Rework seeded as normal sequential stage | Playbook routing: rework `onPass: review` not next sortOrder |
| Deploy manual gate leaves run non-terminal | `fallback: complete` on deploy — no ambiguous hold |
| `proceed` has no state target | `onPass` / `onFail` are explicit state names |

## Open Questions (deferred to implementation planning)

1. **Skill file hot-reload** — does the orchestrator watch for file changes and
   reload playbooks/skills without restart, or require a daemon restart?

2. **Playbook validation on save** — does the web UI validate YAML schema before
   writing the file? What is the error UX for invalid playbooks?

3. **LangGraph checkpoint retention** — how long are checkpoints kept? Does
   cleanup-service prune them along with worktrees and artifacts?

4. **Result doc schema versioning** — how do we handle schema evolution without
   breaking existing stage run records?

5. **GitHub PR merge implementation** — the deploy skill needs `mergePullRequest`
   which is still `NotImplementedError` in the GitHub adapter. Separate issue.

6. **Bundled skill library** — what skills ship with fluxaOS by default beyond
   Standard Dev? Separate design decision.
