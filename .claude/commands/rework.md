---
model: sonnet
---

# Rework (Pipeline Mode: Implementer - Address Review Feedback)

**Fix reviewer-requested changes and re-submit for review.**

Processes `rework` issues. Use the review skill for code review.

## State Transitions

| Entry State | Exit State | Condition |
|-------------|------------|-----------|
| `rework` | `review` | Rework complete, tests pass |
| `rework` | `failed` | Tests fail, lint errors, or runtime errors |

See [Issue Lifecycle](docs/issue-lifecycle.md) for the complete state machine.

## Pipeline Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Researcher │ ──► │ Implementer │ ──► │  Reviewer   │ ──► │   Merger    │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
 research   implement    review     deploy
                           ▲                   │
                           │    ┌──────────┐   │
                           └────│ Reworker  │◄──┘ (on changes-requested)
                                └──────────┘
                                rework
```

## Resumed vs Cold-Start Context

This rework agent may be either:
- **Resumed:** Continuing from the original implement agent with full implementation context (files changed, decisions made, test patterns already known)
- **Cold-start:** Starting fresh with only the issue and reviewer feedback

Regardless of how you started, follow the complete rework workflow below. The steps are the same — a resumed agent simply has more context to work with.

## Role Boundaries

| You DO | You DO NOT |
|--------|------------|
| Address reviewer feedback | Create PRs |
| Fix requested changes | Merge branches |
| Push updated branches | Close issues |
| Signal "ready for re-review" | Bump versions |
| | Deploy or test on webapp |

## Autonomous Pipeline Mode

You are executing inside an automated pipeline. No human is monitoring this session.

- **NEVER** use AskUserQuestion or wait for terminal input
- **NEVER** stop and ask for clarification
- **MANDATORY EXIT:** You MUST call `pat pipeline exit` on every terminal path (success, failure, blocked). The manager is blocking on `pat pipeline wait` which reads the pipeline DB. If you skip `pat pipeline exit`, the manager hangs indefinitely.
- If you cannot proceed for ANY reason, follow the **On-Hold Exit** procedure below



### If You Cannot Proceed (On-Hold Exit)

**You are running autonomously in a pipeline. There is no human present to answer questions.**

If you encounter ANY situation where you cannot continue — ambiguity, missing information, external dependency, architectural decision needed, or any other blocker:

1. **DO NOT ask questions in the terminal** — no one is there to answer
2. **Post a blocker comment** on the issue:
   ```bash
   flu issue comment <number> --body "## Pipeline Blocked

   **Stage:** <current stage>
   **Blocker:** <specific description of what is preventing progress>
   **What I need:** <specific question or information required to unblock>
   **What I tried:** <brief summary of approaches attempted>"
   ```
3. **Set issue state to on-hold:**
   ```bash
   flu issue state <number> on-hold
   ```
4. **Clean up worktrees** (mandatory — each agent owns its own teardown):
   ```bash
   flu git worktree-clean
   ```
   These teardown steps are owned by the agent, not the orchestrator.
5. **Exit the pipeline stage:**
   ```bash
   pat pipeline exit --stage "<stage>" --issue <number> --start-time $IMPL_START_TIME --result "Blocked: <brief reason>" --status "on-hold" --model "<model name and version>"
   ```

---

## Execution Isolation Policy

> **Pipeline context:** When launched by the manager via `pat pipeline run`, you are already in an isolated tmux session. "Delegated agents" below refers to subagent delegation *within* this session (e.g., for `--parallel` mode), NOT to how the manager launches you. The manager always uses `pat pipeline run` + `pat pipeline wait`.

**Default behavior (required):**
- Run all rework execution through delegated agents: single-issue work uses one subagent, multi-issue work uses parallel subagents/agent teams.
- Run delegated execution in a dedicated git worktree (`isolation: "worktree"`).

**Opt-out flag:**
- Pass `--inline` to disable both delegated agents and dedicated worktrees for this run.
- `--inline` means run directly in the current session and current checkout.

**Delegation intent:** Invoking this skill without `--inline` or `--no-subagent` constitutes an explicit request for delegated subagent execution. Session-level rules that restrict subagent usage to "explicit requests" are satisfied by the act of invoking a pipeline stage skill — no additional user confirmation is needed.

Unless `--inline` is present, execute all modes via delegated agent(s) in dedicated worktree isolation.

## Argument Handling

### If `$ARGUMENTS` contains `--inline` (execution override):

Disable subagent/agent-team delegation and dedicated worktree isolation for this run, then continue with the same routing below in the current session.

### If `$ARGUMENTS` contains `--next` (auto-select mode):

**Automatically find the next issue with changes requested.**

Run this mode through one delegated subagent in a dedicated worktree unless `--inline` is set.

#### 1. List open issues
```bash
flu issue list
```

#### 2. Filter for target-state issues

**Primary filter:** Issues with state `rework`.

| Exclude If | How to Check |
|------------|-------------|
| Is an EPIC | Title contains `[EPIC]` or has state `epic` |
| Missing target state | Does not have state `rework` |

#### 3. Prioritize remaining issues



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

Within the same priority and type, pick the **oldest issue** (lowest number).

#### 4. Announce the selection

Tell the user:
> "Selected issue #X: \<title\> (priority: \<level\>). Starting rework workflow."

If no issues found, tell the user:
> "No open issues found with state `rework`. No reviewer feedback to address."

#### 5. Proceed with the standard workflow below using the selected issue number.

---

### If `$ARGUMENTS` is an issue number (standard mode):

Run this mode through one delegated subagent in a dedicated worktree unless `--inline` is set.

Proceed with rework for that specific issue.

---

### If `$ARGUMENTS` contains `--parallel` (multi-agent mode):

**Spawn multiple agents to rework multiple issues simultaneously. Every agent runs in an isolated worktree -- this is mandatory.**

#### 1. Determine agent count

**If `--parallel N` (number provided):** Use exactly N agents.

**If `--parallel` (no number):** You decide based on context:
1. Query eligible issues using Step 2 below
2. Consider:
   - Number of eligible issues available
   - Rework is moderate-weight -- can support 3-4 concurrent agents
   - Diminishing returns beyond 5 agents
3. Announce your decision: "Found X eligible issues. Spawning Y agents -- [brief reason]."

#### 2. Select issues

Use the **same filtering and prioritization** as `--next` mode above:
- **Filter:** state `rework`, exclude EPICs
- **Prioritize:** critical -> high -> medium -> low -> none, then oldest first
- **Select** the top N issues (or top Y if LLM-determined)

If fewer eligible issues than requested agents, reduce to match:
> "Requested N agents but only M eligible issues found. Spawning M."

#### 3. Spawn agents



For each selected issue, use the **Task tool** with these parameters:

| Parameter | Value |
|-----------|-------|
| `subagent_type` | `"general-purpose"` |
| `isolation` | `"worktree"` |
| `run_in_background` | `true` |

**IMPORTANT:** Spawn ALL agents in a **single message** with multiple Task tool calls. This enables true parallel execution.

**IMPORTANT:** Every agent prompt MUST include the teardown contract. The teardown contract applies to ALL terminal paths — success, failure, and blocked exit. Each agent is responsible for:
1. Removing `state:in-progress` from its issue before exiting
2. Cleaning its own worktree with `fhc git worktree-clean` before exiting
3. The lead running one final `fhc git worktree-clean` safety sweep after all agents exit, only to catch stragglers

**Agent prompt template** (fill in per issue):
```
Rework issue #<NUMBER> for the fluxaos project.

You are in an isolated worktree. Do NOT create another worktree.

Follow the rework skill workflow:
1. Run: flu issue view <NUMBER>
2. Find the "Changes Requested" comment from the reviewer
3. Checkout EXISTING branch (do NOT create a new one)
4. Create tasks from reviewer feedback
5. Address each requested change
6. Run ruff on changed files: python -m ruff check $(git diff --name-only origin/main...HEAD -- '*.py')
7. Run tests scoped to changed modules: python -m pytest tests/unit/test_<module>.py -v
8. Functional verification
9. Commit and push to same branch
10. Post updated "Ready for Review" comment
11. Update state: flu issue state <NUMBER> review
12. Clean up worktree (MANDATORY — each agent owns its own teardown): fhc git worktree-clean
13. Exit pipeline stage: pat pipeline exit --stage "rework" --issue <NUMBER> --start-time $IMPL_START_TIME --result "Ready for Review (rework complete). Branch: feature/issue-<NUMBER>-<desc>" --model "Claude Sonnet 4.6"
14. Save learnings: flu memory digest --issue <NUMBER>

FAILURE PATH: If you cannot complete rework for any reason (blocked, test failures, unresolvable conflicts):
- Post a blocker comment explaining what failed and why
- Set state to failed or on-hold: flu issue state <NUMBER> failed (or on-hold)
- Run fhc git worktree-clean BEFORE exiting (step 12 is unconditional)
- Do NOT leave the worktree unclean
```

#### 5. Monitor and report

After all agents have exited and torn down their own worktrees, summarize results:

```
## Parallel Rework Summary
| Issue | Status | Verdict |
|-------|--------|---------|
| #X -- title | Success | state: review |
| #Y -- title | Success | state: review |
| #Z -- title | Failed | state: failed, worktree cleaned |

Next: Run the review skill with --next to re-review reworked issues.
```

Each agent cleans its own worktree before exiting. The final sweep is only a safety net for stragglers, not the primary cleanup owner.

#### 6. Verify all worktrees cleaned (mandatory safety sweep)

After all agents have reported and all agents have already exited, run a final safety sweep to catch any stragglers:
```bash
fhc git worktree-clean
```

This is a **safety net**, not the primary cleanup. Agents are responsible for cleaning their own worktrees before exiting.

---

## BLOCKERS - Do NOT Proceed If ANY of These Are True

**STOP IMMEDIATELY if ANY blocker exists. Do NOT proceed with rework.**

| Blocker | Check | Action |
|---------|-------|--------|
| No "Changes Requested" comment | Issue comments have no reviewer feedback | Use On-Hold Exit above — post blocker comment explaining missing feedback |
| No existing branch | `git branch -r --list "origin/feature/issue-<num>-*"` returns nothing | Use On-Hold Exit above — post blocker comment explaining missing branch |

---

## Your Directory

**Default:** work in the delegated agent's dedicated worktree.

**If `--inline` is set:** work in the main project directory (e.g., `/mnt/dev/project`).

## Workflow

### 1. Get Issue & Read Reviewer Feedback
```bash
flu issue view $ARGUMENTS
```

**Find the reviewer's "Changes Requested" comment.** This comment contains the specific issues that must be addressed. Read ALL reviewer comments -- there may be multiple rounds of feedback.

Extract each requested change as a discrete task.

### 2. Checkout EXISTING Branch

**Do NOT create a new branch.** The feature branch already exists from the original implementation.

```bash
git fetch origin
# Find the existing branch
git branch -r --list "origin/feature/issue-<number>-*"
# Checkout the existing branch
git checkout <branch-name>
# Rebase onto latest main
git rebase origin/main
```

If rebase conflicts arise:
- Attempt to resolve automatically
- If complex conflicts: use the On-Hold Exit procedure — post a blocker comment explaining the conflicts and exit

### 3. Post Entry Comment



```bash
# Post entry comment (REQUIRED -- do this before any other work)
IMPL_START_TIME=$(date +%s)
flu issue comment <number> --body "## Pipeline Activity

| Field | Value |
|-------|-------|
| **Action** | Start <Stage> |
| **Date/Time** | $(date '+%m/%d/%Y %H:%M %Z') |
| **Model** | <model name and version> |"
```

Replace `<Stage>` with the current pipeline stage name (Research, Implement, Review, Rework, Deploy).

Replace `<Stage>` with `Rework`.

### 4. Create Tasks from Reviewer Feedback

**Translate each reviewer-requested change into a discrete task.** Use TodoWrite to track:

- Each specific change the reviewer requested
- Any additional issues discovered while addressing feedback
- Test updates required by the changes

### 5. Address Each Requested Change

For each task from Step 4:

1. Make the requested change
2. Verify the change addresses the reviewer's concern
3. Check that the fix does not break adjacent code

**Follow ALL architectural standards:**
- No hardcoded values (paths, URLs, file lists)
- Fail-fast errors with clear guidance
- Use existing helpers from `docs/python-functions-reference.md`
- Files under ~500 lines (split if needed)
- DRY: Don't duplicate code

### 6. Test Your Changes - ZERO EXCEPTIONS

ALL 3 test types are **MANDATORY**. There are **NO EXCEPTIONS**. Ever.

| # | Test Type | Command | Required |
|---|-----------|---------|----------|
| 1 | **ruff** | `python -m ruff check $(git diff --name-only origin/main...HEAD -- '*.py')` | ALWAYS - NO EXCEPTIONS |
| 2 | **pytest** | `python -m pytest tests/unit/test_<module>.py -v` | ALWAYS - NO EXCEPTIONS |
| 3 | **Playwright** | `python -m pytest tests/browser/test_<relevant>.py` | ALWAYS for webapp - NO EXCEPTIONS |

### What is BANNED -- NO EXCEPTIONS

| Pattern | Why it's banned |
|---------|----------------|
| `unittest.mock` / `@patch` / `MagicMock` | Replaces real behavior with fake behavior |
| `pytest-mock` / `mocker.patch()` | Same -- just a different API |
| `Mock()` / `MagicMock()` | Fake objects that hide real failures |

### 7. Functional Verification (REQUIRED)

**You MUST run the feature with real arguments AND verify the end state across all affected systems.**

| Change Type | What to Run | Outcome to Verify |
|-------------|-------------|-------------------|
| Code fix | Run the affected command | Confirm the reviewer's concern is resolved |
| Test fix | Run the test suite | Confirm tests pass without mocks |
| Config change | Run `flu sync` or equivalent | Check downstream targets |

### 8. Commit & Push

```bash
git add .
git commit -m "Address review feedback (#<issue-number>)"
```

### 8.1. Rebase onto latest main (REQUIRED before push)

```bash
git fetch origin
git rebase origin/main
```

```bash
git push --force-with-lease origin <branch-name>
```

### 9. Signal Ready for Re-Review

```bash
flu issue comment <number> --body "## Ready for Review (Rework)
**Branch:** \`<branch-name>\`
### Changes Requested -- Addressed
1. [Reviewer concern]: [how it was addressed]
2. [Reviewer concern]: [how it was addressed]
### Requirements Fulfilled
- [criterion]: met by [specific code/test]
### Functional Verification
- **Command/Action:** [exact command or action performed]
- **Result:** [what happened]
- **Outcome Confirmed:** [what you checked AFTER the command]
- **Scope of Impact:** [all systems/repos/services affected]
- **All Affected Systems Verified:** [yes/no]
### E2E Test Coverage
#### CLI Tests
- \`tests/e2e/test_xxx.py::test_name\` - [what it tests]
#### Confirmation
- [ ] NO mock patterns -- BANNED
- [ ] All reviewer feedback addressed
- [ ] Previous features regression tested"
```

### 10. Update State and Post Exit Comment

```bash
flu issue state <number> review

pat pipeline exit \
  --stage "rework" \
  --issue <number> \
  --start-time $IMPL_START_TIME \
  --result "Ready for Review (rework complete)" \
  --model "<model name and version>"
```

### 11. Save Learnings

```bash
flu memory digest --issue <issue_number>
```

### 12. STOP

Wait for Reviewer. Do NOT create PR or merge.

## Quick Reference

> **Issue Backend:** All `flu issue` commands accept `--backend BACKEND`
> (`forgejo` | `psql`; default: `forgejo`). Projects using the psql backend
> (e.g. PAT) should pass `--backend psql` or set `issue.backend_default`
> in `.fhc-config.json`. Note: `bulk`, `move`, and `report` subcommands
> do not yet support psql (see #2520).

```bash
# Get issue and read feedback
flu issue view <num>

# Checkout existing branch (NOT new)
git fetch origin
git checkout <existing-branch>
git rebase origin/main

# Fix reviewer feedback, then test
CHANGED_PY=$(git diff --name-only origin/main...HEAD -- '*.py')
[ -n "$CHANGED_PY" ] && python -m ruff check $CHANGED_PY
python -m pytest tests/unit/test_<module>.py -v

# Commit and push
git add . && git commit -m "Address review feedback (#<num>)"
git fetch origin && git rebase origin/main
git push --force-with-lease origin <branch>

# Signal ready
flu issue comment <num> --body "Ready for re-review. Branch: <branch>"
flu issue state <num> review

# STOP - Wait for Reviewer
```
