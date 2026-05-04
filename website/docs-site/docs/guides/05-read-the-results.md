---
sidebar_position: 5
title: "Guide 5: Read the Results"
---

# Guide 5: Read the Results

After a pipeline run completes, this guide shows you where to find each piece of information and what it means.

## The Run Detail Modal

Open a run from the issue page (click **View Details** or the run history entry). The modal has three main areas:

### Left panel — run metadata

- **Status** — final run status: Completed, Failed, Timed Out, Cancelled
- **Trigger** — always "manual" for user-triggered runs
- **Started / Duration** — when the run started and how long it took
- **Cost** — total cost in USD across all stages (only shown if > $0)
- **Stage timeline** — clickable list of all stages with status badges

### Right panel — stage details

Click any stage in the timeline to see its details:

**Output tab:**
- Full transcript of the stage's stdout, formatted as:
  - Text messages from the AI
  - Tool calls (e.g., bash commands the AI ran)
  - Tool results (indented; red border = error)
  - Final result with cost and token counts
- Toggle **Raw JSON** to see the raw event payloads (useful for debugging)
- Toggle **Verbose** to show lifecycle events (launched, completed) and all tool results

**Gates tab:**
- Shows pass/fail for each gate rule
- Green checkmark = rule passed
- Red X = rule failed, with the actual value that caused the failure
- Overall verdict: Proceed, Hold, Rework, or Abort

## The Activity Feed

The activity feed on the issue page shows **issue-level events** — not stage output. This includes:
- State changes (e.g., "Moved from Research to Implement")
- Comments posted by skills (from the result document's `comment` field)
- Blockers surfaced by skills

For stage output (the AI's actual work), always use the Run Detail Modal.

## Understanding costs and tokens

- **Cost** is the sum of all stage `costUsd` values from the result documents
- **Tokens** are broken into input and output, per stage
- Cost only appears if the driver reported it in the result document metadata (`meta.input_tokens`, `meta.output_tokens`)

## What to do when a run fails

1. Open the Run Detail Modal
2. Check the **Output tab** — look for the last tool call and its error output
3. Check the **Gates tab** — if a rule failed, the verdict and reason are shown there
4. Check the issue's **State and Status** — `Blocked` status means a skill emitted `blocked` verdict or a `needs_human` signal and needs your attention
5. Fix the underlying issue (update the skill prompt, fix the code, clear the blocker), then trigger a new run
