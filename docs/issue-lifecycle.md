# Issue Lifecycle Reference

This document is the authoritative reference for issue states, statuses, priorities, and
transitions as seeded in `src/core/db/seed.ts`. Update both files together whenever the
data model changes.

---

## Issue States

States represent where an issue is in the pipeline workflow. Each issue has exactly one
state at a time.

| Key | Display | Color | Terminal | Notes |
|-----|---------|-------|----------|-------|
| `new` | New | `#6b7280` | No | Just created, not yet started |
| `research` | Research | `#3b82f6` | No | Research stage running or pending |
| `implement` | Implement | `#a855f7` | No | Implementation in progress |
| `review` | Review | `#f59e0b` | No | Awaiting code review |
| `rework` | Rework | `#ef4444` | No | Reviewer requested changes |
| `deploy` | Deploy | `#22c55e` | No | Approved, awaiting merge/deploy |
| `complete` | Complete | `#10b981` | **Yes** | Done — terminal state |

---

## Issue Statuses

Statuses represent the operational state of the issue (what the system is doing with it),
independent of pipeline stage.

| Key | Display | Meaning |
|-----|---------|---------|
| `open` | Open | Active, not running |
| `queued` | Queued | In BullMQ queue, waiting to run |
| `running` | Running | A stage is actively executing |
| `blocked` | Blocked | Needs human intervention |
| `completed` | Completed | Pipeline run finished (issue may still be in a non-terminal state) |

Status is set automatically via config entries (`issues.status.on_*_key`).

---

## Issue Priorities

| Key | Display | Weight | Color |
|-----|---------|--------|-------|
| `critical` | Critical | 100 | `#ef4444` |
| `high` | High | 200 | `#f97316` |
| `medium` | Medium | 300 | `#eab308` |
| `low` | Low | 400 | `#6b7280` |

Lower weight = higher priority in queue ordering.

---

## State Transitions

Valid state transitions are enforced by the `issue_transition` table. Only these moves
are permitted.

| From | To | Description |
|------|----|-------------|
| `new` | `research` | Start research |
| `new` | `implement` | Skip research, start implementing |
| `research` | `implement` | Begin implementation |
| `implement` | `review` | Submit for review |
| `implement` | `research` | Back to research |
| `review` | `rework` | Needs rework |
| `review` | `deploy` | Approve for deploy |
| `rework` | `review` | Resubmit for review |
| `deploy` | `complete` | Mark complete |
| `complete` | `implement` | Reopen |

> **Signal-driven jumps bypass this table.** The orchestrator uses `issueService.stateOverride()`
> for `hold/already_complete` signals — no transition entry required. The transition table
> is enforced only for human-initiated moves in the UI.

---

## Skill Signal Protocol

Skills communicate their verdict to the orchestrator via a `flux:signal` JSON line on
stdout. The orchestrator reads this and acts accordingly.

### Signal Shape

```json
{
  "flux:signal": {
    "verdict": "<proceed|hold|rework|abort>",
    "summary": "Human-readable explanation",
    "reason": "<already_complete|needs_human>",
    "meta": {
      "targetState": "<state key>"
    }
  }
}
```

### Verdict Meanings

| Verdict | Meaning | Orchestrator Action |
|---------|---------|---------------------|
| `proceed` | Work done, move forward | Advance to next pipeline stage |
| `hold` | Pause — see `reason` | See below |
| `rework` | This stage needs to be retried | Re-run stage (up to `maxRetries`) |
| `abort` | Unrecoverable failure | Fail the pipeline run |

### `hold` Reasons

| Reason | Meaning | Orchestrator Action |
|--------|---------|---------------------|
| `already_complete` | Issue is ahead of its current state | Transition issue to `meta.targetState` |
| `needs_human` | Ambiguous requirements, blocked, needs decision | Set issue status to `blocked`, surface to user — no automated transition |

### `already_complete` Examples

```json
// Research finds implement + review + deploy all done → jump to complete
{"flux:signal": {"verdict": "hold", "reason": "already_complete", "meta": {"targetState": "complete"}}}

// Research finds implement done but not reviewed → jump to review
{"flux:signal": {"verdict": "hold", "reason": "already_complete", "meta": {"targetState": "review"}}}

// Research finds implement done, reviewed, approved → jump to deploy
{"flux:signal": {"verdict": "hold", "reason": "already_complete", "meta": {"targetState": "deploy"}}}
```

### `needs_human` Example

```json
// Skill cannot determine the right approach without a decision
{"flux:signal": {"verdict": "hold", "reason": "needs_human", "meta": {"question": "Should this use OAuth or API keys?"}}}
```

---

## Pipeline Stages vs Issue States

Pipeline stages and issue states are related but distinct:

- **Pipeline stages** (`research`, `implement`, `review`, `rework`, `deploy`) are steps in a
  `pipeline_stage` configuration — they define what skill runs and in what order.
- **Issue states** (`new`, `research`, `implement`, ...) are the issue's position in
  the workflow — driven by transitions, not directly by stage execution.

The orchestrator advances issue state as pipeline stages complete. A skill can also
signal a jump to a non-sequential state via `hold/already_complete`.
