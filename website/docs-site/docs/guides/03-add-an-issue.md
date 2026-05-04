---
sidebar_position: 3
title: "Guide 3: Add an Issue"
---

# Guide 3: Add an Issue

Issues are the units of work that pipelines operate on. This guide covers creating an issue and understanding the two fields you'll see change as it moves through the pipeline.

## Step 1: Create an issue

1. Navigate to your project's **Issues** page
2. Click **New Issue**
3. Fill in:
   - **Title**: A clear description of the work (e.g., "Add health check endpoint")
   - **Type**: Bug, Feature, or Task
   - **Priority**: Critical, High, Medium, or Low
   - **Description** (optional): Markdown-formatted context, requirements, or acceptance criteria
4. Click **Create**

The issue is created in **New** state with **Open** status.

## Step 2: Understand state and status

Every issue shows two badges: a **state** and a **status**. These are independent — see [State vs Status](../concepts/state-vs-status) for a full explanation.

**State** = where the issue is in the workflow:
- Starts at `New`
- Moves through `Research → Implement → Review → Rework → Deploy → Complete` as pipeline stages succeed
- You can also move state manually

**Status** = what fluxaOS is doing with it right now:
- `Open` — not currently running
- `Queued` — a run is waiting for the daemon
- `Running` — a stage is executing right now
- `Blocked` — needs your attention

## Step 3: Review the issue before running

Before triggering a pipeline, make sure:
- The title and description are clear (this is what the AI skill reads)
- The state is correct (the pipeline stage that runs will be matched to this state)
- You've set the default pipeline (from Guide 2)

---

**Next:** [Guide 4: Run a Pipeline →](./run-a-pipeline)
