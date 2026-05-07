---
sidebar_position: 3
title: Gate Rules
---

# Gate Rules

Gate rules define conditions that must pass before a stage proceeds. They're evaluated by the gate engine after a stage completes and produce a verdict that routes the pipeline.

## Rule structure

Each rule has five fields:

| Field | Type | Purpose |
|-------|------|---------|
| `field` | string | What to check (see fields table below) |
| `operator` | string | How to compare (see operators table below) |
| `value` | any | The threshold to compare against |
| `severity` | string | How bad a failure is (`warn`, `required`, `block`) |
| `onFail` | string | What to do when the rule fails |
| `label` | string | Human-readable description shown in the UI |

## Available fields

Gate rules evaluate against the stage-run context produced by the database-backed pipeline executor.

| Field | Type | Description |
|-------|------|-------------|
| `exit_code` | integer | Process exit code (0 = success) |
| `cost_usd` | number | Total cost in USD (currently reported as `0` — result doc parsing is not wired into the DB-stage gate context yet) |
| `tokens_in` | integer | Input token count (currently `0` — same limitation) |
| `tokens_out` | integer | Output token count (currently `0` — same limitation) |
| `provider` | string | Provider name reported by the driver |
| `model` | string | Model identifier reported by the driver |
| `driver` | string | Driver name |

## Operators

| Operator | Meaning |
|----------|---------|
| `equals` | Exact match |
| `not_equals` | Not equal |
| `less_than` | Strictly less than |
| `greater_than` | Strictly greater than |
| `contains` | String or array contains value |
| `matches` | Regex match |
| `in` | Value is in a list |
| `exists` | Field is present and non-null |

## Severity levels

| Severity | Meaning |
|----------|---------|
| `warn` | Rule failure is logged and shown in the UI but does not affect routing |
| `required` | Rule failure triggers `onFail` action |
| `block` | Same as `required` but displayed prominently as a blocker |

## onFail actions

| Action | Effect |
|--------|--------|
| `proceed` | Ignore the failure; continue |
| `hold` | Pause the run for manual decision |
| `rework` | Route to `onFail` stage |
| `abort` | Stop the pipeline; mark the run failed |
| `notify` | Log the failure (no routing change) |
| `escalate` | Escalate for attention (no routing change) |

## Verdict resolution

When multiple rules fail, the gate engine takes the **worst** `onFail` action across all failed rules (severity order: `abort` > `rework` > `hold` > `proceed`). That worst action becomes the gate verdict.

## Example

Hold if the stage process exits non-zero, and warn if it ran on a non-preferred provider:

```yaml
rules:
  - field: exit_code
    operator: equals
    value: 0
    severity: block
    onFail: hold
    label: "Stage process exited successfully"
  - field: provider
    operator: equals
    value: anthropic
    severity: warn
    onFail: proceed
    label: "Preferred provider warning"
```
