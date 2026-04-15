

id: deploy
stage: deploy
description: Merger workflow for approved changes, deployment verification, and closeout.
default_profile: claude-max
default_model: sonnet

## body

# Deploy (Pipeline Mode: Merger - Merge Only)

**Merge approved PRs, verify deployment, version bump, and close issues.**

Processes `deploy` issues. Use the review skill for code review.

## State Transitions

| Entry State | Exit State | Condition |
|-------------|------------|-----------|
| `deploy` | `completed` | PR merged, deployment verified, issue closed |

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
- Run all deploy execution through delegated agents: single-issue work uses one subagent, multi-issue work uses parallel subagents/agent teams.
- Run delegated execution in a dedicated git worktree (`isolation: "worktree"`).

**Opt-out flag:**
- Pass `--inline` to disable both delegated agents and dedicated worktrees for this run.
- `--inline` means run directly in the current session and current checkout.

**Delegation intent:** Invoking this skill without `--inline` or `--no-subagent` constitutes an explicit request for delegated subagent execution. Session-level rules that restrict subagent usage to "explicit requests" are satisfied by the act of invoking a pipeline stage skill — no additional user confirmation is needed.

## Role Boundaries

| You DO | You DO NOT |
|--------|------------|
| Create & merge PRs | Review code |
| Test deployment | Implement features |
| Bump versions | Re-review approved work |
| Close issues | |
| Clean up branches | |

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
   log to docs/superpowers/deferred-fixes.md: "## Pipeline Blocked

   **Stage:** <current stage>
   **Blocker:** <specific description of what is preventing progress>
   **What I need:** <specific question or information required to unblock>
   **What I tried:** <brief summary of approaches attempted>"
   ```
3. **Set issue state to on-hold:**
   ```bash
   ```
4. **Clean up worktrees** (mandatory — each agent owns its own teardown):
   ```bash
   git worktree prune
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

**Automatically find the next approved issue ready for merge.**

Run this mode through one delegated subagent in a dedicated worktree unless `--inline` is set.

#### 1. List open issues
```bash
```

#### 2. Filter for target-state issues

**Primary filter:** Issues with state `deploy`.

| Exclude If | How to Check |
|------------|-------------|
| Is an EPIC | Title contains `[EPIC]` or has state `epic` |
| Missing target state | Does not have state `deploy` |

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
> "Selected issue #X: \<title\> (priority: \<level\>). Starting merge workflow."

If no issues found, tell the user:
> "No open issues found with state `deploy`. Wait for reviewer to approve work via the review skill."

#### 5. Proceed with the standard workflow below using the selected issue number.

---

### If `$ARGUMENTS` is an issue number (standard mode):

Run this mode through one delegated subagent in a dedicated worktree unless `--inline` is set.

Proceed with merge for that specific issue.

---

## Your Directory

**Default:** work in the delegated agent's dedicated worktree.

**If `--inline` is set:** work in the main project directory (e.g., `/mnt/dev/project`).

## Workflow

### 1. Get Issue & Branch
```bash
review the issue: $ARGUMENTS
# Find branch name from approval comment or "Ready for Review" comment
```

### 1.1. Post Entry Comment



```bash
# Post entry comment (REQUIRED -- do this before any other work)
IMPL_START_TIME=$(date +%s)
log to docs/superpowers/deferred-fixes.md: "## Pipeline Activity

| Field | Value |
|-------|-------|
| **Action** | Start <Stage> |
| **Date/Time** | $(date '+%m/%d/%Y %H:%M %Z') |
| **Model** | <model name and version> |"
```

Replace `<Stage>` with the current pipeline stage name (Research, Implement, Review, Rework, Deploy).

Replace `<Stage>` with `Deploy`.

### 2. Pre-Merge Rebase and Test

**Process approved PRs one-at-a-time with this sequence:**

```bash
# Fetch latest main
git fetch origin

# Record HEAD before rebase
PRE_REBASE_SHA=$(git rev-parse HEAD)

# Rebase PR branch onto latest main
git checkout <branch>
git rebase origin/main

# Check if rebase changed anything
POST_REBASE_SHA=$(git rev-parse HEAD)
```

If rebase conflicts arise:
- Attempt to resolve automatically

**If `PRE_REBASE_SHA` equals `POST_REBASE_SHA` (rebase was a no-op — already up to date):**
- Skip test re-run. Tests from implement/review phases are still valid for unchanged code.
- Document: "Rebase was a no-op (already up to date). Skipping test re-run — prior results still valid."

**If SHAs differ (rebase changed the commit graph):**
- Re-run scoped tests as the rebase may have introduced issues:

```bash
# Determine changed files for scoped testing
CHANGED_PY=$(git diff --name-only origin/main...HEAD -- '*.py')

# Run lint on changed files only
if [ -n "$CHANGED_PY" ]; then
    python -m ruff check $CHANGED_PY
fi

# Run tests scoped to changed modules
# Map source files to test files: src/package/module/file.py -> tests/unit/*test_file*.py
# Use: git diff --name-only origin/main...HEAD | grep -E '^src/.*\.py$'
# Then find matching tests with Glob and run them
python -m pytest tests/unit/test_<module>.py -v
```

If tests fail after rebase:
```bash
log to docs/superpowers/deferred-fixes.md: "## Merge Blocked -- Tests Fail After Rebase
Tests failed after rebasing onto latest main:
\`\`\`
[paste test output]
\`\`\`
Returning to changes-requested for investigation."

```
**STOP** - Move to next approved issue.

### 3. Create PR and Merge

```bash
# Push rebased branch
git push --force-with-lease origin <branch>

# Create PR and merge
git checkout main
git pull origin main
```

### 4. Post-Merge Functional Verification

**Project capabilities:** webapp={{WEBAPP}}, service_name={{SERVICE_NAME}}, has_logs={{HAS_LOGS}}

**If `{{WEBAPP}}` is `false` AND `{{SERVICE_NAME}}` is empty, skip the service restart and log check -- no service to check.**

If `{{WEBAPP}}` is `true`:
```bash
```

#### 4a. Post-Restart Log Check -- MANDATORY (NO EXCEPTIONS, BLOCKING)

**You MUST check service logs for startup errors before proceeding. This step is NOT conditional -- execute it every time a service exists. Skipping is NOT permitted when `{{SERVICE_NAME}}` is not empty.**

**If `{{SERVICE_NAME}}` is empty, skip this step -- no systemd service for this project.**

If `{{SERVICE_NAME}}` is not empty:
```bash
# Check last 2 minutes of webapp service logs for errors
sudo journalctl -u {{SERVICE_NAME}} --since "2 minutes ago" --no-pager 2>/dev/null | grep -iE "error|exception|traceback|critical|fatal" | head -20
```

**Pass/fail criteria:**

| Log Pattern | Verdict | Action |
|-------------|---------|--------|
| No ERROR/EXCEPTION/TRACEBACK lines | PASS | Proceed to functional verification |
| Startup errors (bind failed, module not found, config error) | **FAIL** | STOP -- revert or coordinate fix with Implementer |
| Transient warnings only (deprecation, non-critical) | PASS with note | Proceed, document warnings in issue comment |
| Service failed to start (exit code != 0) | **FAIL** | STOP -- check `systemctl status {{SERVICE_NAME}}` |

**If log check FAILS:** Do NOT proceed to functional verification. The deployment has a startup error that must be resolved first.

#### 4a-2. Application Log File Check -- MANDATORY (NO EXCEPTIONS, BLOCKING)

**If `{{HAS_LOGS}}` is `false`, skip this step -- no application log file for this project.**

If `{{HAS_LOGS}}` is `true`:

**You MUST check the application's own log file for errors that don't surface in journalctl. Skipping is NOT permitted when `{{HAS_LOGS}}` is `true`.**



```bash
if [ -z "$LOG_DIR" ] || [ ! -d "$LOG_DIR" ]; then
    LOG_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/logs"
fi
LOG_FILE=""
if [ -d "$LOG_DIR" ]; then
    LOG_FILE=$(ls -t "$LOG_DIR"/*.log 2>/dev/null | head -1)
fi
if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
    tail -50 "$LOG_FILE" | grep -iE "error|exception|traceback|critical|fatal" | head -20
fi
```

**Pass/fail criteria:**

| Finding | Verdict | Action |
|---------|---------|--------|
| No application log file (file logging disabled) | PASS | Not applicable -- proceed |
| No ERROR/EXCEPTION/CRITICAL/FATAL lines in recent entries | PASS | Proceed to functional verification |
| Errors caused by the deployed changes | **FAIL** | STOP -- revert or coordinate fix with Implementer |
| Pre-existing errors unrelated to this deployment | PASS with note | Document in issue comment, proceed |
| Transient warnings only | PASS with note | Proceed, document warnings |

**If app log check FAILS:** Do NOT proceed to functional verification. The deployment introduced application-level errors.

#### 4b. Functional Verification

**Re-run the implementer's functional verification in production AND independently verify the end state.**

This is a homelab -- dev is production. "Command ran" is not enough. You must verify the **outcome** across all affected systems.

1. Read the implementer's Functional Verification section from the issue
2. Run the same command/action on the deployed code
3. **Independently verify the outcome** -- don't just check command output, check the actual end state
4. Document BOTH the command result AND the outcome verification:

```bash
log to docs/superpowers/deferred-fixes.md: "### Post-Merge Verification
- **Log Check:** PASS/FAIL [any warnings noted]
- **Command/Action:** [same as implementer's]
- **Result:** [what happened in production]
- **Outcome Verified:** [what I independently checked to confirm the end state]
- **Affected Systems Checked:** [list of repos/services/files verified]
- **All Systems Correct:** [yes/no -- if no, detail what's wrong]"
```

**If outcome verification reveals problems:** STOP -- revert or coordinate fix before closing the issue.

#### 4c. Deployed Webapp Verification (webapp={{WEBAPP}})

**If `{{WEBAPP}}` is `false`, skip this step -- this project has no webapp.**

If `{{WEBAPP}}` is `true`, you MUST visit the deployed URL in a real browser and verify the feature works.

1. Open the deployed URL in a browser
2. Navigate to the page(s) affected by the change
3. Verify the feature works as expected (not just that the page loads)
4. Test logout flow: logout -> navigate to protected page -> verify redirect to login
5. Capture screenshot evidence of the feature working

### 5a. Tests Fail
Revert or coordinate fix with Implementer.

### 5b. Tests Pass - Version Bump

```bash
# Version bump -- tag-based, no branch/PR needed
git checkout main && git pull origin main
```

### 6. Clean Up Worktrees
```bash
# Remove stale Claude agent worktrees and repair editable-install .pth files
git worktree prune
```

### 7. Cleanup & Close
```bash
# Delete feature branch
git branch -d <feature-branch>
git push origin --delete <feature-branch>

# Close and update state
log to docs/superpowers/deferred-fixes.md: "Completed via PR #X (vX.X.X)"
```



### EPIC Auto-Close Check


If for any reason you closed an issue without using the CLI (e.g., via direct API call or Forgejo web UI), you can trigger the check by re-closing:

```bash
```

**What this does:**
- Looks for `(EPIC #N)` in the issue title or `Part of EPIC #N` in the body
- If found, checks if all other children of that EPIC are closed
- If all children are closed, posts a summary comment and closes the EPIC
- Handles `wontfix`/closed children equally (both count as resolved)
- Only checks children in the same repository




**Before calling `pat pipeline exit`, apply the shared teardown contract** (partial: `pipeline-teardown`). `pat pipeline exit` handles the notification only — it does NOT perform cleanup.

```bash
# Remove per-phase in-progress indicator, post exit comment, notify manager, kill session
# NOTE: Ensure state:in-progress is removed and worktree is cleaned before calling this.
pat pipeline exit --stage "<stage>" --issue <number> --start-time $IMPL_START_TIME --result "<result summary>" --model "<model name and version>"
```

Replace `<stage>`, `<number>`, `<result summary>`, and `<model name and version>` with the appropriate values for the current pipeline stage.

> **Teardown dependency:** `pat pipeline exit` handles session shutdown but does NOT clean up worktrees or remove `state:in-progress`. Those steps must be completed first — see the teardown contract (`

### Teardown Contract (ALL Terminal Paths)

**This teardown MUST run on every terminal path: success, failure, partial failure, and blocked exit.**
Teardown is mandatory on failure paths and blocked exits, not only on success.

There is no "happy path only" exception. If the agent session ends for any reason, teardown runs.

#### Step 1: Worktree Removal (if running in a worktree)

Run `git worktree prune` as the canonical cleanup entrypoint (or execute the equivalent checks/removal sequence below if needed in-context).

```bash
WORKTREE_DIR=$(git rev-parse --show-toplevel)
MAIN_DIR=$(git worktree list | head -1 | awk '{print $1}')

if [ "$WORKTREE_DIR" != "$MAIN_DIR" ]; then
    BRANCH=$(git -C "$WORKTREE_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)
    TARGET_BRANCH="$BRANCH"
    UPSTREAM_REF="origin/$BRANCH"

    # Safety checks before removal — never silently discard work
    # Fail closed: if upstream ref lookup or git log fails, treat the branch as unpushed
    if ! git -C "$WORKTREE_DIR" rev-parse --verify "$UPSTREAM_REF" >/dev/null 2>&1; then
        UNPUSHED="(upstream ref missing — cannot verify)"
    elif ! UNPUSHED_OUT=$(git -C "$WORKTREE_DIR" log --oneline "$UPSTREAM_REF..$BRANCH" 2>/dev/null); then
        UNPUSHED="(git log failed — cannot verify)"
    else
        UNPUSHED="$UNPUSHED_OUT"
    fi
    DIRTY_UNSTAGED=$(git -C "$WORKTREE_DIR" diff --quiet 2>/dev/null; echo $?)
    DIRTY_STAGED=$(git -C "$WORKTREE_DIR" diff --cached --quiet 2>/dev/null; echo $?)

    if [ -n "$UNPUSHED" ] || [ "$DIRTY_UNSTAGED" != "0" ] || [ "$DIRTY_STAGED" != "0" ]; then
        echo "WARNING: Worktree has unsaved state — skipping removal. Review manually."
        echo "  Unpushed commits: $UNPUSHED"
        git -C "$WORKTREE_DIR" status --short
    else
        cd "$MAIN_DIR"
        git worktree remove "$WORKTREE_DIR"
        git worktree prune
        echo "Worktree removed: $WORKTREE_DIR"
    fi
fi
```

#### Step 2: Branch Cleanup (success path only)

Branch deletion is **only safe on the success path** where the branch is confirmed merged.
On failure and blocked paths, the branch MUST be preserved for diagnosis and re-entry.

```bash
# Success path only — delete branch only when fully merged
if [ -z "$TARGET_BRANCH" ]; then
    echo "Branch cleanup skipped: target branch was not captured before teardown."
elif git branch -r --merged origin/main --format='%(refname:short)' | grep -qxF "origin/$TARGET_BRANCH"; then
    git push origin --delete "$TARGET_BRANCH" 2>/dev/null && echo "Remote branch deleted: $TARGET_BRANCH" || true
    git branch -d "$TARGET_BRANCH" 2>/dev/null && echo "Local branch deleted: $TARGET_BRANCH" || true
else
    echo "Branch not yet merged — preserved: $TARGET_BRANCH"
fi
```

#### Teardown Decision Table

| Path | Remove Worktree | Delete Branch |
|------|-----------------|---------------|
| Success (merged) | YES (if clean) | YES (after merge confirmed) |
| Failure (`failed`) | NO — preserve for diagnosis | NO — preserve for re-entry |
| Blocked (`on-hold`) | NO — preserve for re-entry | NO — preserve for re-entry |
| Partial failure (some agents failed) | NO for failed agents | NO for failed branches |
`).


Replace `<stage>` with `deploy`, `<number>` with the issue number, `<result summary>` with `Completed. PR merged, version bumped, issue closed.`, and `<model name and version>` with the current model.

### 8. Clean Up Test Artifacts

```bash
# Remove Playwright test failure screenshots
rm -rf tests/browser/screenshots/
```

**Why:** After successful merge, test failure screenshots from development are no longer needed.

### On Failure

If merge or deployment fails at any point:

```bash
# Post standardized blocker comment
log to docs/superpowers/deferred-fixes.md: "## Pipeline Blocked

**Stage:** deploy
**Blocker:** Merge/deploy failed — [which step failed]
**What I need:** [specific action needed to unblock, e.g. manual conflict resolution, service restart]
**What I tried:** [brief summary of steps attempted]"

# Set issue to on-hold (not actively being worked on, review is still valid)

# Signal the manager so it doesn't hang on pat pipeline wait
pat pipeline exit --stage "deploy" --issue <number> --start-time $IMPL_START_TIME --result "Blocked: Merge/Deploy Failed" --status "on-hold" --model "<model name and version>"
```

**Note:** The review is still valid. The failure is in merge/deploy, not in the code review. The state has been set to `on-hold` to signal the issue needs manual intervention before re-entering the pipeline.

## Quick Reference

> (`forgejo` | `psql`; default: `forgejo`). Projects using the psql backend
> (e.g. PAT) should pass `--backend psql` or set `issue.backend_default`
> in `.fhc-config.json`. Note: `bulk`, `move`, and `report` subcommands
> do not yet support psql (see #2520).

```bash
# Get issue
review the issue: <num>

# Rebase and test
git fetch origin
git checkout <branch> && git rebase origin/main
CHANGED_PY=$(git diff --name-only origin/main...HEAD -- '*.py')
[ -n "$CHANGED_PY" ] && python -m ruff check $CHANGED_PY
python -m pytest tests/unit/test_<module>.py -v

# Merge (only after rebase + tests pass)
git push --force-with-lease origin <branch>
git checkout main
git pull origin main

# Test Deployment (only if {{WEBAPP}} is true)

# Version bump -- tag-based
git checkout main && git pull origin main

# Clean up stale Claude agent worktrees
git worktree prune

# Close and update state
log to docs/superpowers/deferred-fixes.md: "Completed via PR #X (vX.X.X)"
```
