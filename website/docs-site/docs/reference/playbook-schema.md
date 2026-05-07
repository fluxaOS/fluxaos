---
sidebar_position: 5
title: Historical Playbook Schema
---

# Historical Playbook Schema

> Historical reference only. Active fluxaOS pipeline execution is DB-owned/config-driven; bundled YAML playbooks and `FLUXAOS_BUNDLED_PIPELINES_DIR` are not an operator surface in the current engine. This page is intentionally removed from the docs sidebar so old PRs/handoffs can still resolve links without teaching new operators the wrong model.

A playbook was a YAML file that defined a pipeline as a graph of stages. The current product stores pipeline stages, skills, drivers, gates, and routing in the database instead.

## Top-level fields

| Field | Required | Type | Purpose |
|-------|----------|------|---------|
| `name` | Yes | string | Display name; used to look up the playbook |
| `description` | Yes | string | Human-readable description |
| `prompt` | Yes | string | System prompt injected into every stage's context |
| `stages` | Yes | array | One or more stage definitions |

## Stage types

### Sequential (default)

Runs one skill. If `type` is omitted, sequential is assumed.

```yaml
- id: research
  skill: research
  onPass: implement    # next stage on pass verdict
  onFail: research     # next stage on fail verdict
  fallback: blocked    # next stage on blocked verdict
  trustMode: prescriptive  # prescriptive | declarative
  rules: []            # gate rules (same format as UI rules)
```

| Field | Required | Default | Purpose |
|-------|----------|---------|---------|
| `id` | Yes | | Unique stage identifier within this playbook |
| `skill` | Yes | | Skill name to run |
| `onPass` | Yes | | Next stage ID on pass verdict |
| `onFail` | Yes | | Next stage ID on fail verdict |
| `fallback` | Yes | | Next stage ID on blocked verdict |
| `trustMode` | No | `prescriptive` | `prescriptive` = follow rules strictly; `declarative` = skill has more autonomy |
| `rules` | No | `[]` | Gate rules array |

### Parallel group

Runs multiple skills concurrently, then aggregates their verdicts.

```yaml
- type: parallel
  id: parallel-review
  children:
    - id: lint-check
      skill: lint-review
    - id: security-check
      skill: security-review
  aggregation: all-pass   # how to aggregate child verdicts
  onPass: deploy
  onFail: rework
  fallback: blocked
```

| Field | Required | Default | Purpose |
|-------|----------|---------|---------|
| `type` | Yes | | Must be `parallel` |
| `children` | Yes | | Array of child stages (minimum 2); each has `id` and `skill` |
| `aggregation` | Yes | | How to combine child verdicts: `all-pass`, `any-pass`, `majority-pass`, or `none` |
| `onPass` | Yes | | Next stage ID when aggregation condition is met |
| `onFail` | Yes | | Next stage ID when aggregation condition is not met |
| `fallback` | Yes | | Next stage ID on blocked verdict |

### Loop node

Repeats a skill until a condition is met or a maximum iteration count is reached.

```yaml
- type: loop
  id: review-loop
  skill: code-review
  until: VERDICT_PASS       # stop condition
  maxIterations: 5          # hard cap
  onComplete: deploy        # next stage when loop exits successfully
  onExhausted: rework       # next stage when maxIterations is hit
  fallback: blocked         # next stage on blocked verdict
```

| Field | Required | Default | Purpose |
|-------|----------|---------|---------|
| `until` | Yes | | Stop condition (see below) |
| `maxIterations` | No | `10` | Maximum number of iterations before `onExhausted` |
| `onComplete` | Yes | | Next stage when the `until` condition is met |
| `onExhausted` | Yes | | Next stage when `maxIterations` is hit |

**`until` values:**

| Value | Meaning |
|-------|---------|
| `VERDICT_PASS` | Stop when skill emits `pass` verdict |
| `VERDICT_FAIL` | Stop when skill emits `fail` verdict |
| `ISSUE_OUT_OF_ACTIVE_STATE` | Alias for `VERDICT_PASS` — stops when the skill emits `pass` verdict. The skill is expected to check whether the issue has left active state and emit `pass` when it has. |
| `ALWAYS` | Always loop until `maxIterations` is hit |

## Special stage IDs

| ID | Meaning |
|----|---------|
| `complete` | Pipeline finishes successfully; issue moves to `Complete` state |
| `blocked` | Pipeline halts; issue status set to `Blocked` |

## Example: standard-dev playbook

```yaml
name: standard-dev
description: Research → implement → review → deploy with conditional rework.
prompt: |
  You are a fluxaOS pipeline agent running in headless, unattended mode.
  Your only job is to do the work your skill describes and produce an honest
  result document at the path in the ${RESULT_DOC_PATH} environment variable.

stages:
  - id: research
    skill: research
    onPass: implement
    onFail: research
    fallback: blocked

  - id: implement
    skill: implement
    onPass: review
    onFail: rework
    fallback: blocked
    rules:
      - field: timing.duration_sec
        operator: less_than
        value: 7200
        severity: warn
        onFail: hold
        label: Implementation time cap (2 hours)

  - id: review
    skill: review
    onPass: deploy
    onFail: rework
    fallback: blocked

  - id: rework
    skill: rework
    onPass: review
    onFail: blocked
    fallback: blocked
    rules:
      - field: run.attempt
        operator: less_than
        value: 4
        severity: block
        onFail: abort
        label: Rework attempt cap (3 max)

  - id: deploy
    skill: deploy
    onPass: complete
    onFail: blocked
    fallback: complete
```
