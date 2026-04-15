---
model: opus
---

# Review (Pipeline Mode: Reviewer - Review Only)

**Review code and verify implementation. Does NOT merge or deploy.**

For merge/deploy, use the deploy skill after approval.

## State Transitions

| Entry State | Exit State | Condition |
|-------------|------------|-----------|
| `review` | `deploy` | Code review passes |
| `review` | `rework` | Reviewer found issues |

See [Issue Lifecycle](docs/issue-lifecycle.md) for the complete state machine.

## Pipeline Overview



```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Researcher │ ──► │ Implementer │ ──► │  Reviewer   │ ──► │   Merger    │
│  (optional) │     │             │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
 research            implement            review               deploy
                           ▲                   │
                           │    ┌──────────┐   │
                           └────│ Reworker │◄──┘ (on changes-requested)
                                └──────────┘
                                 rework
```

## Execution Isolation Policy

> **Pipeline context:** When launched by the manager via `pat pipeline run`, you are already in an isolated tmux session. "Delegated agents" below refers to subagent delegation *within* this session (e.g., for `--parallel` mode), NOT to how the manager launches you. The manager always uses `pat pipeline run` + `pat pipeline wait`.

**Default behavior (required):**
- Run all review execution through delegated agents: single-issue work uses one subagent, multi-issue work uses parallel subagents/agent teams.
- Run delegated execution in a dedicated git worktree (`isolation: "worktree"`).

**Opt-out flag:**
- Pass `--inline` to disable both delegated agents and dedicated worktrees for this run.
- `--inline` means run directly in the current session and current checkout.

**Delegation intent:** Invoking this skill without `--inline` or `--no-subagent` constitutes an explicit request for delegated subagent execution. Session-level rules that restrict subagent usage to "explicit requests" are satisfied by the act of invoking a pipeline stage skill — no additional user confirmation is needed.

## Role Boundaries

| You DO | You DO NOT |
|--------|------------|
| Review code | Implement features |
| Verify implementation | Create or merge PRs |
| Approve or request changes | Deploy or bump versions |
| Rebase stale branches | Close issues |

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

## Argument Handling

Unless `--inline` is present, execute all modes via delegated agent(s) in dedicated worktree isolation.

### If `$ARGUMENTS` contains `--inline` (execution override):

Disable subagent/agent-team delegation and dedicated worktree isolation for this run, then continue with the same routing below in the current session.

### If `$ARGUMENTS` contains `--next` (auto-select mode):

**Automatically find the next issue ready for review.**

Run this mode through one delegated subagent in a dedicated worktree unless `--inline` is set.

#### 1. List open issues
```bash
flu issue list
```

#### 2. Filter for target-state issues

**Primary filter:** Issues with state `review`.

| Exclude If | How to Check |
|------------|-------------|
| Is an EPIC | Title contains `[EPIC]` or has state `epic` |
| Missing target state | Does not have state `review` |

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
> "Selected issue #X: \<title\> (priority: \<level\>). Starting review workflow."

If no issues found, tell the user:
> "No open issues found with state `review`. Wait for implementer to complete work."

#### 5. Proceed with the standard workflow below using the selected issue number.

---

### If `$ARGUMENTS` is an issue number (standard mode):

Run this mode through one delegated subagent in a dedicated worktree unless `--inline` is set.

Proceed with review for that specific issue.

---

### If `$ARGUMENTS` contains `--parallel` (multi-agent mode):

**Spawn multiple agents to review multiple issues simultaneously. Every agent runs in an isolated worktree — this is mandatory.**

Review is parallelizable because it does not merge code. Each agent reviews independently and transitions issues to state `deploy` or `rework`. The sequential deploy skill handles merges one at a time.

See `references/parallel-mode.md` for agent count rules, issue selection, and the agent prompt template.

#### Spawn agents



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

Use the agent prompt template from `references/parallel-mode.md`. After all agents have exited and torn down their own worktrees, report using the summary table format also in `references/parallel-mode.md`.

#### Verify all worktrees cleaned (mandatory safety sweep)

After all agents have reported and all agents have already exited, run this **mandatory** safety sweep to catch any stragglers:
```bash
fhc git worktree-clean
```

This is a safety net — agents are responsible for cleaning their own worktrees before exiting (see agent prompt template in `references/parallel-mode.md`).

---

## BLOCKERS - Do NOT Proceed If ANY of These Are True

### Blockers Checklist

Read `references/blockers-checklist.md` for the full per-type blocking criteria. Use it to determine whether each issue found is a blocker, warning, or informational.

---

## Your Directory

**Default:** work in the delegated agent's dedicated worktree.

**If `--inline` is set:** work in the main project directory (e.g., `/mnt/dev/project`).

## Workflow

### 1. Get Issue & Branch
```bash
flu issue view $ARGUMENTS
# Find branch name from "Ready for Review" comment
```

### 1.1. Post Entry Comment



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

Replace `<Stage>` with `Review`.

### 1.5. Requirements Fulfillment Gate

**BLOCKING -- validate requirements BEFORE reviewing code quality.**

Read `references/review-code-criteria.md` (Requirements Fulfillment Gate section) for the full procedure: reading acceptance criteria, cross-referencing against the diff, and the blocking rule with comment template.

### 2. Review Code

You are a critical code reviewer, not a checklist verifier. The implementer may have met every acceptance criterion and still produced code that is incomplete, fragile, overcomplicated, or wrong. Your job is to independently analyze the diff and catch what the implementer missed — not to confirm what they claim.

```bash
git fetch origin
git diff origin/main..origin/<branch-name>
```

Read `references/review-code-criteria.md` for the full review criteria checklists: independent diff analysis, project standards enforcement, architecture and design quality, rejection guidance, and functional verification evidence gate.

### 2.1. Check branch freshness

```bash
git fetch origin
BEHIND=$(git rev-list --count origin/<branch>..origin/main)
```

If BEHIND > 0, the branch is stale. Auto-rebase:

```bash
git checkout <branch>
git rebase origin/main
# Resolve any conflicts
git push --force-with-lease origin <branch>
git checkout main
```

Post a comment:
```bash
flu issue comment <number> --body "Branch rebased onto current main (was $BEHIND commits behind). Proceeding with review."
```

If rebase fails with complex conflicts, post changes-requested comment and move to next issue.

### 2.5. Verify Pre-Existing Issue Reports

Read `references/review-code-criteria.md` (Pre-Existing Issue Reports section) for the full verification checklist.

### 3. Run Verification (REQUIRED)

**CRITICAL**: As reviewer, YOU are responsible for verification.

**IMPORTANT - Verification Rules:**
- Do NOT assume closed issues were verified
- Do NOT skip verification for any reason
- Do NOT abbreviate verification based on issue status
- Check issue comments for existing verification report first

#### Check for Existing Verification
```bash
flu issue view <issue-number> --comments | grep -A 5 "Verification Report"
```

- **If no verification comment exists:** Run the verify-issue skill (required)
- **If verification comment exists:** Review it, then decide if re-verification needed
- **When in doubt:** Always re-verify

#### Run Issue Verification

Run the verify-issue skill with <issue-number>.

**Review the verification report for:**
- Implementation Status: Must be COMPLETE
- Architectural Compliance: Must be PASS
- Documentation: Must be COMPLETE or NOT_REQUIRED
- Testing: Must be ADEQUATE or NOT_REQUIRED

#### Run Browser Verification (webapp=false)

**If `false` is `false`, skip this step -- this project has no webapp.**

If `false` is `true`, run the verify-webapp skill.

### 4. Verdict

**After EITHER verdict below, post a Pipeline Activity exit comment** with `Stop Review` action. Use the result from the verdict (e.g., "Changes Requested" or "Approved. Ready for merge."). Compute duration from `IMPL_START_TIME` captured at entry.

#### 4a. If Changes Needed (Reject)
```bash
flu issue comment <number> --body "## Changes Requested
1. [Issue]
2. [Issue]"

# State transition: review -> rework
flu issue state <number> rework

# Exit pipeline stage (posts exit comment, notifies manager, kills session)
pat pipeline exit --stage "review" --issue <number> --start-time $IMPL_START_TIME --result "Changes Requested" --model "<model name and version>"
```

**STOP** - Wait for Implementer to fix issues.

#### 4b. If Approved
```bash
flu issue comment <number> --body "## Approved
Review passed. Ready for merge.

**Verified:**
- Requirements fulfillment: PASS
- Code quality: PASS
- Functional verification evidence: PASS
- Branch freshness: PASS
- Test verification: PASS"

# State transition: review -> deploy
flu issue state <number> deploy

# Exit pipeline stage (posts exit comment, notifies manager, kills session)
pat pipeline exit --stage "review" --issue <number> --start-time $IMPL_START_TIME --result "Approved. Ready for merge." --model "<model name and version>"
```

**STOP** - The deploy skill handles PR creation, merge, deploy, and cleanup.

## Quick Reference

> **Issue Backend:** All `flu issue` commands accept `--backend BACKEND`
> (`forgejo` | `psql`; default: `forgejo`). Projects using the psql backend
> (e.g. PAT) should pass `--backend psql` or set `issue.backend_default`
> in `.fhc-config.json`. Note: `bulk`, `move`, and `report` subcommands
> do not yet support psql (see #2520).

```bash
# Review
git fetch origin && git diff origin/main..origin/<branch>

# Verify (REQUIRED)
# Run the verify-issue skill with <num>
# Run the verify-webapp skill (only if false is true)

# Approve
flu issue comment <num> --body "Approved. Ready for merge."
flu issue state <num> deploy

# Reject
flu issue comment <num> --body "## Changes Requested\n1. [Issue]"
flu issue state <num> rework
```
