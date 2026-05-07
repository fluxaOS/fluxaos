---
sidebar_position: 7
title: State vs Status
---

# State vs Status

This is the most commonly confused distinction in fluxaOS. Every issue has **two** independent fields: a **state** and a **status**. They mean different things and change at different times.

## State — Where is the issue in the workflow?

State represents the issue's position in the development lifecycle. It maps to pipeline stages: when the research stage completes successfully, the issue moves from `research` state to `implement` state.

| State | Meaning |
|-------|---------|
| `New` | Just created, not yet started |
| `Research` | Research stage running or queued |
| `Implement` | Implementation in progress |
| `Review` | Awaiting code review |
| `Rework` | Reviewer requested changes |
| `Deploy` | Approved, awaiting merge/deploy |
| `Complete` | Done — terminal state, issue is closed |

State transitions are controlled by the pipeline. The orchestrator moves the issue forward when a stage completes with a `pass` verdict. You can also move state manually in the UI. See [Issue States](../reference/issue-states) for the full transition table.

## Status — What is the system doing right now?

Status represents the operational condition of the issue — what fluxaOS is actively doing with it, regardless of where it is in the workflow.

| Status | Meaning |
|--------|---------|
| `Open` | Active, not currently running |
| `Queued` | A stage run is queued, waiting for the daemon |
| `Running` | A stage is actively executing right now |
| `Blocked` | Needs human intervention (skill emitted `blocked` verdict or `needs_human` signal) |
| `Completed` | The most recent pipeline run finished |

Status changes automatically as the daemon picks up and executes runs. You do not set it manually.

## Why this matters

An issue can be in `Implement` state with `Running` status (a stage is executing), or `Implement` state with `Blocked` status (the stage ran but got stuck). The state tells you *where* in the pipeline the issue is; the status tells you *what's happening to it right now*.

When something goes wrong, check **both fields**: state tells you which stage to look at, status tells you whether the daemon is actively working on it.

## Deploy outcome is separate from pipeline truth

A completed pipeline means every required stage reached its terminal success condition. Post-pipeline deploy is tracked separately in `deploy_run` with one row per `pipeline_run`.

| Deploy status | Meaning |
|---------------|---------|
| `succeeded` | Deploy bridge committed/pushed work and opened or recorded the PR |
| `skipped` | Deploy was intentionally skipped, such as `no-changes` or `no-issue` |
| `failed` | Deploy failed after the pipeline had already reached terminal state |

Deploy failures do **not** rewrite `stage_run.status` or `pipeline_run.status`. Those rows remain the source of truth for pipeline execution; `deploy_run` is the source of truth for post-pipeline deploy outcome.
