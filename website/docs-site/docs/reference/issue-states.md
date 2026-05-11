---
sidebar_position: 4
title: Issue States
---

# Issue States

See [State vs Status](../concepts/state-vs-status) for an explanation of the difference between state and status.

## States

| State | Color | Terminal | Meaning |
|-------|-------|----------|---------|
| `New` | Gray | No | Just created, not yet started |
| `Research` | Blue | No | Research stage running or pending |
| `Implement` | Purple | No | Implementation in progress |
| `Review` | Amber | No | Awaiting code review |
| `Rework` | Red | No | Reviewer requested changes |
| `Deploy` | Green | No | Approved, awaiting merge/deploy |
| `Complete` | Teal | **Yes** | Done — issue is closed |

When an issue reaches `Complete`, `isClosed` is set to `true` and a `closedAt` timestamp is recorded. Issues in a terminal state cannot be transitioned to another state except by reopening (back to `Implement`).

## Valid transitions

The table below covers human-initiated moves in the UI. **Reason-driven jumps bypass this table** — when an ingested result document includes `signal_reason: "already_complete"` and `signal_meta.targetState`, the orchestrator calls `stateOverride()` directly and transitions the issue to that target state regardless of whether that transition appears here.

| From | To | How |
|------|----|-----|
| `New` | `Research` | Pipeline trigger or manual |
| `New` | `Implement` | Manual (skip research) |
| `Research` | `Implement` | Research stage passes |
| `Implement` | `Review` | Implement stage passes |
| `Implement` | `Research` | Manual |
| `Review` | `Rework` | Review stage fails |
| `Review` | `Deploy` | Review stage passes |
| `Rework` | `Review` | Rework stage passes |
| `Deploy` | `Complete` | Deploy stage passes |
| `Complete` | `Implement` | Manual reopen |

## Statuses

| Status | Meaning |
|--------|---------|
| `Open` | Active, not currently running |
| `Queued` | In the queue, waiting for the daemon to pick it up |
| `Running` | A stage is actively executing |
| `Blocked` | Needs human intervention (result document used `verdict: "blocked"` or `signal_reason: "needs_human"`) |
| `Completed` | Most recent pipeline run finished |

Status is set automatically by the daemon. It is not user-configurable.

## Priorities

| Priority | Weight | Meaning |
|----------|--------|---------|
| `Critical` | 100 | Highest urgency |
| `High` | 200 | |
| `Medium` | 300 | |
| `Low` | 400 | Lowest urgency |

Lower weight = higher priority in queue ordering. The daemon picks up higher-priority runs first.
