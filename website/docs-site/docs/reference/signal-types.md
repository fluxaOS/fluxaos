---
sidebar_position: 2
title: Signal Types
---

# Signal Types

Stages communicate their outcome to the orchestrator via two mechanisms: a **result document** (post-stage) and a **flux:signal stdout line** (during execution). See [Signals concept page](../concepts/signals) for an overview.

## Result document verdicts

| Verdict | Meaning | Default routing |
|---------|---------|-----------------|
| `pass` | Work complete, meets the bar | Gate rules evaluated → `onPass` stage |
| `fail` | Work attempted but did not meet the bar | Gate rules evaluated → `onFail` stage |
| `blocked` | Stage cannot continue | Skip gate rules → `fallback` stage |

## How routing works

For `pass` and `fail` verdicts, gate rules are evaluated first. A gate rule failure can override the routing (e.g., `abort` overrides `onPass`). For `blocked`, routing goes directly to `fallback` — gate rules are not evaluated.

In a YAML playbook stage:

```yaml
- id: implement
  skill: implement
  onPass: review       # where to go on pass verdict (after gates pass)
  onFail: rework       # where to go on fail verdict (or gate failure)
  fallback: blocked    # where to go on blocked verdict
```

The special stage ID `complete` marks the pipeline as finished. The special stage ID `blocked` marks the pipeline as blocked (issue status → Blocked).

## flux:signal stdout protocol

A skill can emit a `flux:signal` line to stdout at any time during execution. The orchestrator reads it and acts before the result document is processed.

```json
{"flux:signal": {"verdict": "hold", "reason": "already_complete", "meta": {"targetState": "review"}}}
```

**Signal verdicts:**

| Verdict | Orchestrator action |
|---------|---------------------|
| `proceed` | Advance to next pipeline stage immediately |
| `hold` | Pause — see `reason` field |
| `rework` | Re-run this stage (up to `maxRetries`) |
| `abort` | Fail the pipeline run immediately |

**`hold` reasons:**

| Reason | Meaning | Orchestrator action |
|--------|---------|---------------------|
| `already_complete` | Issue is ahead of its current state | Transition issue to `meta.targetState` via `stateOverride()` — bypasses the normal transition table |
| `needs_human` | Ambiguous or blocked | Set issue status to `Blocked`; surface to user. `meta.question` carries the message. |

## Gate verdicts

Gate verdicts are produced by the gate engine after evaluating rules. They can override the result document's routing:

| Gate verdict | Effect |
|--------------|--------|
| `proceed` | Continue with the result-document routing |
| `hold` | Pause the pipeline; wait for manual approval |
| `rework` | Route to the `onFail` stage |
| `abort` | Stop the pipeline immediately; mark the run failed |

See [Gate Rules](./gate-rules) for how gate verdicts are produced.
