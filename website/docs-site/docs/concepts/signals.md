---
sidebar_position: 6
title: Signals
---

# Signals

A signal is how a stage communicates its outcome to the pipeline. In the DB-first runtime, the routing signal is the **result document**: a JSON file written to `$RESULT_DOC_PATH` and ingested after the stage subprocess exits.

## Result document

After the subprocess finishes, the orchestrator reads the result document at `$RESULT_DOC_PATH`. This is the primary signal for post-stage routing.

| Field | Required | Purpose |
|-------|----------|---------|
| `verdict` | Yes | `"pass"`, `"fail"`, or `"blocked"` |
| `summary` | Yes | One sentence describing what happened |
| `comment` | No | Text to post as a comment on the issue |
| `blockers` | No | Array of `{title, description}` objects |
| `artifacts` | No | Array of filenames produced in `$ARTIFACTS_DIR` |
| `meta.model` | No | Model identifier used |
| `meta.input_tokens` | No | Input token count |
| `meta.output_tokens` | No | Output token count |

**Verdict meanings:**

- `pass` — work is complete; gate rules are evaluated, then `onPass` routing applies
- `fail` — work was attempted but did not meet the bar; `onFail` routing applies
- `blocked` — the stage cannot continue; gate rules are skipped; `fallback` routing applies

The orchestrator posts `comment` text to the issue, surfaces `blockers` in the UI, and records `artifacts` for download.

## Signal metadata

Some seeded stage prompts still describe a `flux:signal` shape as shorthand for the stage outcome:

```json
{"flux:signal": {"verdict": "hold", "reason": "already_complete", "meta": {"targetState": "review"}}}
```

Signal verdicts: `proceed`, `hold`, `rework`, `abort`.

That shape does **not** create an immediate stdout fast path in the DB-first runtime. The orchestrator ingests `$RESULT_DOC_PATH` after the subprocess exits, maps `verdict` (`pass`, `fail`, `blocked`) to pipeline routing, and reads optional `signal_reason` / `signal_meta` fields from the result document when it needs reason-specific behavior.

`signal_reason` can carry hold-style reasons:
- `already_complete` — issue is ahead of its current state; `signal_meta.targetState` tells the orchestrator where to jump. **Reason-driven jumps bypass the normal state transition table** — the orchestrator calls `stateOverride()` directly.
- `needs_human` — ambiguous or blocked; sets issue status to `Blocked` and surfaces it for human review. `signal_meta.question` can carry a message.

For the full signal type reference, see [Signal Types](../reference/signal-types).

## Realtime dependency {#realtime}

Live updates in the UI depend on Supabase Realtime. The orchestrator writes stage events to the database as they arrive; Realtime pushes those writes to the browser. If the connection is interrupted, the UI will stop updating for that run — it shows the last known state until reconnected.
