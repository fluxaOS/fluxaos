---
sidebar_position: 4
title: "Guide 4: Run a Pipeline"
---

# Guide 4: Run a Pipeline

This guide covers triggering a pipeline run against an issue and understanding what happens during execution.

## Prerequisites

- Daemon is running (runs stay at "Pending" if it's not — see [Daemon](../reference/daemon))
- You have a default pipeline set on your project (Guide 2)
- You have an issue in a non-terminal state (Guide 3)

## Step 1: Trigger a run

1. Open the issue detail page
2. In the **Pipeline Stages** card, find the stage that matches the issue's current state
3. Click **Run Stage**

fluxaOS creates a `pipeline_run` and `stage_run` in `pending` status and returns immediately. The daemon picks up the run asynchronously.

## Step 2: Watch execution

The issue status changes to `Queued`, then `Running` as the daemon picks it up.

To see live output, click **View Details** on the run card (or open the Run Detail Modal). You'll see:

- **Status badge** — updates in real time: Pending → Running → Completed / Failed
- **Stage timeline** — each stage as a card, color-coded by status
- **Output tab** — live transcript of everything the AI printed, including tool calls, tool results, and final cost
- **Gates tab** — pass/fail for each gate rule (if configured)

The UI updates automatically via Supabase Realtime. If you don't see updates, check your network connection — see the [Realtime dependency note in Signals](../concepts/signals#realtime).

## Step 3: Handle a manual gate (hold)

If a stage has `gateMode: hold`, execution pauses after the stage completes. You'll see three buttons:

- **Approve** — proceed to the next stage
- **Rework** — mark the stage as failed and route to rework
- **Abort** — cancel the entire run

Review the stage output in the Output tab before deciding.

## Step 4: Check the issue state after the run

Once the run completes, the issue state advances automatically. If the research stage passed, the issue moves from `Research` to `Implement` state. The status returns to `Open` (ready for the next trigger) or `Blocked` (needs your attention).

To run the next stage, repeat from Step 1.

---

**Next:** [Guide 5: Read the Results →](./read-the-results)
