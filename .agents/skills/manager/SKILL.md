---
name: "manager"
description: "Lifecycle orchestrator that drives issues end-to-end. Supports inline (default), subagent-per-stage (--subagent), and parallel multi-issue (--parallel) modes."
---
# Manager (Issue Lifecycle Orchestrator)

**Drive one or more issues through their full lifecycle in this session.**

Accepts an issue number, `--next`, or `--parallel [N]`. Reads current issue state, then runs the required lifecycle stages until completion or a terminal stop.

## Flags

| Flag | Description |
|------|-------------|
| *(none)* | **Inline mode** — stages run directly in this session, no subagents, no worktrees |
| `--subagent` | **Subagent mode** — each stage is delegated to a subagent in an isolated worktree; main session just orchestrates |
| `--parallel [N]` | **Parallel mode** — run N issues concurrently, each managed by its own subagent; implies `--subagent`; if N is omitted, auto-select count based on eligible issues |

Flags may be combined with `--next` or a specific issue number:
- `manager 42 --subagent` — run issue 42 with subagent stage delegation
- `manager --next --subagent` — auto-select next issue, delegate stages to subagents
- `manager --parallel 3` — run 3 issues in parallel, each with subagent stage delegation
- `manager --parallel` — auto-determine count from eligible issues

## State-to-Skill Mapping

| Issue State | Skill to Run Next | Expected Exit State |
|-------------|-------------------|---------------------|
| `research` | research | `implement` |
| `implement` | implement | `review` |
| `review` | review | `deploy` or `rework` |
| `rework` | rework | `review` |
| `deploy` | deploy | `completed` |

## Role Boundaries

| You DO | You DO NOT |
|--------|------------|
| Orchestrate lifecycle sequencing | Use external session orchestration to launch stages |
| Run stage skills directly or via subagents | Use external pipeline CLI commands to run or wait for stages |
| Read issue state between stages | Use DB waiting loops |
| Stop on terminal or unsafe conditions | Exceed parallel limit without explicit user flag |

## Hard Constraints

- Accept arguments: `<number>`, `--next`, or `--parallel [N]` only.
- In inline mode: execute stages directly in this session; no subagents; no worktrees.
- In subagent mode: each stage is a subagent call in an isolated worktree; manager only sequences.
- In parallel mode: each issue gets its own subagent managing its full lifecycle; manager monitors all.
- Never use external session/pipeline orchestration tooling or DB waiting loops.

## Argument Handling

1. If argument contains `--parallel`, enter parallel mode.
2. If argument is `--next` (with `--subagent`), enter auto-select mode with subagent delegation.
3. If argument is `--next` (without flags), enter auto-select inline mode.
4. If argument is a numeric issue id, enter specific issue mode (inline or subagent per flags).
5. Otherwise, stop with: `Manager requires an issue number, --next, or --parallel.`

## Parallel Mode (`--parallel [N]`)

### 1. Determine issue count

**If `--parallel N` (number provided):** Use exactly N issues.

**If `--parallel` (no number):** Query eligible issues (same filter as auto-select below), then pick a count:
- Up to 4 concurrent issues is a reasonable default
- Announce: "Found X eligible issues. Running Y in parallel — [brief reason]."

### 2. Select issues

Use the same filter as auto-select mode below. Select the top N by priority.

If fewer eligible issues than requested, reduce count and announce:
> "Requested N but only M eligible issues found. Running M."

### 3. Spawn one subagent per issue

For each selected issue, spawn a background subagent (Agent tool, `isolation: "worktree"`, `run_in_background: true`) with this prompt:

```
You are in an isolated worktree. Do NOT create another worktree.

Drive issue #<NUMBER> through its full lifecycle by running each stage skill in sequence.
After each stage, re-read the issue state with: review the issue: <NUMBER>
Use the state-to-skill mapping to determine the next stage.
Stop when you reach state `completed`, `on-hold`, `failed`, or if a stage does not advance state.
Maximum rework iterations: 3.
Use --inline when invoking each stage skill so they run directly in this session without further delegation.
```

**Spawn ALL agents in a single message** for true parallel execution.

### 4. Monitor and report

Wait for all agents to complete, then summarize:

```
## Parallel Manager Summary
| Issue | Status | Final State |
|-------|--------|-------------|
| #X — title | ✅ Complete | state: completed |
| #Y — title | ⚠️ Stopped | state: on-hold |
```

---

## Subagent Mode (`--subagent`)

In subagent mode the manager orchestrates stage sequencing but delegates each individual stage to a subagent in an isolated worktree.

### Stage execution pattern

For each stage in the lifecycle loop, instead of running the stage skill inline:

1. Spawn a foreground subagent (Agent tool, `isolation: "worktree"`) with this prompt:
   ```
   You are in an isolated worktree. Do NOT create another worktree.
   Invoke the <STAGE> skill with --inline so it runs directly in this session.
   ```
2. Wait for the subagent to complete.
3. Re-read issue state and determine next stage.
4. Repeat.

This keeps each stage isolated and the main session as a clean orchestrator.

---

## Auto-Select Mode (`--next`)

### 1. List open issues

```bash
check docs/superpowers/deferred-fixes.md
```

### 2. Pick one actionable issue

Choose highest priority issue that is not closed and has one of:
- state `research`
- state `implement`
- state `review`
- state `rework`
- state `deploy`

Exclude:
- state `epic`
- state `completed`
- state `on-hold`
- state `failed`

When multiple issues are eligible, apply standard priority rules (`


| Priority | Order |
|----------|-------|
| `priority:critical` | First |
| `priority:high` | Second |
| `priority:medium` | Third |
| `priority:low` | Fourth |
| No priority label | Last |

Within the same priority level, sort by **type** next:

| Type | Order |
|------|-------|
| `type:bug` | First |
| `type:refactor` | Second |
| `type:enhancement` | Third |
| Other/no type label | Last |

Within the same priority and type, pick the **oldest issue** (lowest number).`).

If no issue is eligible, stop with:
`No actionable issues found for manager --next.`

### 3. Continue in specific issue mode with selected issue

## Specific Issue Mode (`<number>`)

### Step 1: Read issue

```bash
review the issue: <number>
```

### Step 2: Validate state

If any of these apply, stop immediately:
- Issue is closed
- No state set
- state is `completed`
- state is `on-hold`
- state is `failed`
- state is `epic`

### Step 3: Run lifecycle loop inline

Loop until terminal state:

1. Read latest issue state:
```bash
review the issue: <number>
```
2. Determine next stage from mapping.
3. If `gate:human-review` exists, pause and ask user before launching the stage.
4. Execute exactly one stage inline by running its skill directly for this issue.
5. Re-read issue state and continue.

### Rework guardrail

Maximum rework iterations in this manager run: **3**.
If exceeded, stop with:
`Issue #<number> exceeded 3 rework iterations; manual intervention required.`

## Terminal Conditions

Stop and report when one occurs:
- state `completed` reached
- issue closed
- stage skill reports non-recoverable failure
- state transition did not advance after a stage run
- user declines a required `gate:human-review` approval

## Failure Handling

If a stage run fails:
1. Re-read issue state.
2. If state moved to `rework`, continue loop.
3. If state moved to `on-hold` or `failed`, stop and report manual intervention required.
4. If state is unchanged and failure reason is unclear, stop and report no-progress.

## Quick Reference

> (`forgejo` | `psql`; default: `forgejo`). Projects using the psql backend
> (e.g. PAT) should pass `--backend psql` or set `issue.backend_default`
> in `.fhc-config.json`. Note: `bulk`, `move`, and `report` subcommands
> do not yet support psql (see #2520).

| Task | Command |
|------|---------|
| Manage one issue inline | `manager <number>` |
| Manage one issue with subagent stages | `manager <number> --subagent` |
| Auto-select next issue, run inline | `manager --next` |
| Auto-select next issue, subagent stages | `manager --next --subagent` |
| Run 3 issues in parallel | `manager --parallel 3` |
| Auto-count parallel issues | `manager --parallel` |
| Check current issue state | `review the issue: <number>` |
| List open issues | `check docs/superpowers/deferred-fixes.md|

## STOP — This Skill Does Not

- Does not use external session orchestration tooling
- Does not use external pipeline CLI run/wait commands
- Does not create or manage worktrees directly (subagent/parallel modes use Agent tool isolation)
- Does not auto-loop forever
- Does not run `--parallel` without the explicit flag
