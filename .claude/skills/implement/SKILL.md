

id: implement
stage: implement
description: Single entry point for implementation work with mode-based routing.
default_profile: claude-max
default_model: sonnet

## body

# Implement (Unified Implementation Orchestrator)

Single entry point for all implementation work. Automatically selects the correct mode based on issue state and arguments.

## State Transitions

| Entry State | Exit State | Condition |
|-------------|------------|-----------|
| `implement` | `completed` | Quick fix applied and committed |
| `implement` | `review` | Pipeline mode complete, tests pass |
| `implement` | `completed` | Standalone mode complete, PR merged |
| `implement` | `failed` | Tests fail, lint errors, or runtime errors |
| `implement` | `research` | Issue instructions incomplete, returned to R&P |

See [Issue Lifecycle](docs/issue-lifecycle.md) for the complete state machine.

---

## MANDATORY: Pre-Implementation Checklist


**Before writing ANY code, verify ALL requirements:**

- [ ] **File size:** No file will exceed ~500 lines
- [ ] **Config-driven:** All values from config files, NOT hardcoded
- [ ] **DRY:** Use existing {{PROJECT}} functions (see `docs/python-functions-reference.md`)
- [ ] **Fail-fast:** No silent defaults or fallback patterns
- [ ] **Path helpers:** All paths via `paths.py` helpers

**Pre-commit hook blocks:** Hardcoded paths, hardcoded URLs, DRY violations.

### Code Debt Prevention (MANDATORY)

Before writing new code, audit the area you're working in:

1. **Identify existing helpers** — Search `docs/python-functions-reference.md` and the codebase for functions that already do what you need. Do NOT create new functions when existing ones work.

2. **Identify competing implementations** — If you find two modules/functions that do the same thing (e.g., two display modules, two config loaders), use the CANONICAL one and flag the duplicate:
   - Check which one is listed in `docs/python-functions-reference.md` — that's canonical
   - If neither is listed, check which has more importers across the codebase
   - If you must use a non-canonical one for consistency with surrounding code, note the tech debt in your Ready for Review comment

3. **Do not carry forward existing violations** — If the file you're modifying already has hardcoded values, fallback patterns, or DRY violations, fix them as part of your change. Do NOT copy existing bad patterns.

4. **Audit imports** — Before adding any import, verify:
   - Is there a canonical module for this functionality in `docs/python-functions-reference.md`?
   - Am I importing from the same module as the rest of the codebase?
   - Am I creating a new dependency on a module that should be deprecated?

---

## Execution Isolation Policy

> **Pipeline context:** When launched by the manager via `pat pipeline run`, you are already in an isolated tmux session. "Delegated agents" below refers to subagent delegation *within* this session (e.g., for `--parallel` mode), NOT to how the manager launches you. The manager always uses `pat pipeline run` + `pat pipeline wait`.

**Default behavior (required):**
- Run all implementation execution through delegated agents: single-issue work uses one subagent, multi-issue work uses parallel subagents/agent teams.
- Run delegated execution in a dedicated git worktree (`isolation: "worktree"`).

**Opt-out flag:**
- Pass `--inline` to disable both delegated agents and dedicated worktrees for this run.
- `--inline` means run directly in the current session and current checkout.

**Delegation intent:** Invoking this skill without `--inline` or `--no-subagent` constitutes an explicit request for delegated subagent execution. Session-level rules that restrict subagent usage to "explicit requests" are satisfied by the act of invoking a pipeline stage skill — no additional user confirmation is needed.

---

## Argument Handling

### Decision Tree

1. `--inline` --> Inline execution override (disable subagent/agent-team and worktree for this run)
2. `--parallel [N]` --> Multi-agent mode (Section A)
3. `--next` --> Auto-select mode (Section B)
4. Number --> Assess and route (Section C)
5. Text --> Quick-task mode (Section D)

Unless `--inline` is present, execute all modes via delegated agent(s) in dedicated worktree isolation.

If `--inline` is present, disable subagent/agent-team delegation and dedicated worktree isolation for this run, then continue with the same routing below in the current session.

---

### Section A: Multi-agent mode (`--parallel`)

**Spawn multiple agents to implement multiple issues simultaneously. Every agent runs in an isolated worktree — this is mandatory.**

#### 1. Determine agent count

**If `--parallel N` (number provided):** Use exactly N agents.

**If `--parallel` (no number):** You decide based on context:
1. Query eligible issues using the filtering in Section B
2. Consider:
   - Number of eligible issues available
   - Implementation is resource-heavy — cap at 3-4 concurrent agents
   - Diminishing returns beyond 5 agents
3. Announce your decision: "Found X eligible issues. Spawning Y agents — [brief reason]."

#### 2. Select issues

Use the **same filtering and prioritization** as `--next` mode (Section B):
- **Filter:** state `implement`, exclude EPICs, exclude issues with existing feature branches, exclude blocked issues
- **Prioritize:** critical --> high --> medium --> low --> none, then oldest first
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
2. Cleaning its own worktree with `git worktree prune` before exiting
3. The lead running one final `git worktree prune` safety sweep after all agents exit, only to catch stragglers


**Agent prompt template** (fill in per issue):
```
Implement issue #<NUMBER> for the {{PROJECT}} project.

You are in an isolated worktree. Do NOT create another worktree.

Follow the implement skill workflow:
1. Run: review the issue: <NUMBER>
2. Verify the issue has complete implementation instructions
3. Read implementation context (parent epic, dependencies)
5. Create feature branch: git checkout -b feature/issue-<NUMBER>-<desc>
6. Implement following ALL architectural standards (no hardcoded values, DRY, fail-fast)
7. Run ruff on changed files: python -m ruff check $(git diff --name-only origin/main...HEAD -- '*.py')
8. Write and run tests: python -m pytest tests/unit/test_<module>.py -v
9. Commit: git add . && git commit -m "Description (#<NUMBER>)"
10. Rebase: git fetch origin && git rebase origin/main
11. Push: git push -u origin feature/issue-<NUMBER>-<desc>
12. Post "Ready for Review" comment with Requirements Fulfilled, Functional Verification, and E2E Test Coverage sections
14. Clean up worktree (MANDATORY — each agent owns its own teardown): git worktree prune

FAILURE PATH: If you cannot complete implementation for any reason (blocked, test failures, lint errors):
- Post a blocker comment explaining what failed and why
- Run git worktree prune BEFORE exiting (step 14 is unconditional)
- Do NOT leave the worktree unclean
```

#### 5. Monitor and report

After all agents have exited and torn down their own worktrees, summarize results:

```
## Parallel Implementation Summary
| Issue | Status | Branch |
|-------|--------|--------|
| #X — title | Success | `feature/issue-X-desc` |
| #Y — title | Success | `feature/issue-Y-desc` |
| #Z — title | Failed | state: failed, worktree cleaned |

Next: Run the review skill with --parallel to review these branches.
```

Each agent cleans its own worktree before exiting. The final sweep is only a safety net for stragglers, not the primary cleanup owner.

#### 6. Verify all worktrees cleaned (mandatory safety sweep)

After all agents have reported and all agents have already exited, run a final safety sweep to catch any stragglers:
```bash
git worktree prune
```

This is a **safety net**, not the primary cleanup. Agents are responsible for cleaning their own worktrees before exiting.

---

### Section B: Auto-select mode (`--next`)

**Automatically find the next issue ready for implementation.**

Run this mode through one delegated subagent in a dedicated worktree unless `--inline` is set.

#### 1. List open issues
```bash
```

#### 2. Filter for target-state issues

**Primary filter:** Issues with state `implement`.

| Exclude If | How to Check |
|------------|-------------|
| Is an EPIC | Title contains `[EPIC]` or has state `epic` |
| Missing target state | Does not have state `implement` |
| Already has a feature branch | `git branch -r --list "origin/feature/issue-<num>-*"` returns results |

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
> "Selected issue #X: \<title\> (priority: \<level\>, state: \<state\>). Starting implementation."

If no issues found, tell the user:
> "No open issues found with state `implement`. Run the research skill with --next to prepare issues for implementation."

#### 5. Proceed using the routing logic in Section C with the selected issue number.

---

### Section C: Assess and route (issue number provided)

**This is the CORE DECISION. Read the issue and route to the correct mode.**

Run this mode through one delegated subagent in a dedicated worktree unless `--inline` is set.

```bash
review the issue: $ARGUMENTS
```

Examine the issue's state to determine the mode:

| Issue State | Mode | Go To |
|-------------|------|-------|
| `implement` | Pipeline mode | Pipeline Mode Workflow |
| No state | Assess from context | Read issue body and decide — if it has R&P instructions use Pipeline, if it's a simple task use Quick Fix, otherwise use Standalone |

---

### Section D: Quick-task mode (text argument)

**For inline task descriptions without an issue number.**

Run this mode through one delegated subagent in a dedicated worktree unless `--inline` is set.

When `$ARGUMENTS` is free text (not a number, not a flag):

1. Parse the task description from the arguments
2. If the task involves a specific component, briefly search memory:
   ```bash
   ```
3. Execute the task — read relevant files, make the change, keep it minimal
4. Verify the change — review the diff to ensure only intended changes were made
5. Commit using the finish workflow:

**If the change is non-code (markdown, templates, docs, config):**
```bash
```

**If the change touches code (.py, .js, etc.):**
```bash
```

**Scope:** Quick-task mode is for typos, grammar fixes, minor tweaks. Not for logic changes, refactoring, or new features.

---

> (`forgejo` | `psql`; default: `forgejo`). Projects using the psql backend
> (e.g. PAT) should pass `--backend psql` or set `issue.backend_default`
> in `.fhc-config.json`. Note: `bulk`, `move`, and `report` subcommands
> do not yet support psql (see #2520).

## Pre-Flight: Branch Health Check

Before starting new implementation work, check for outstanding unmerged branches:

```bash
git fetch origin --prune
BRANCHES=$(git branch -r --list "origin/feature/*" | wc -l)
echo "Outstanding feature branches: $BRANCHES"

git branch -r --list "origin/feature/*" | while read branch; do
  BEHIND=$(git rev-list --count $branch..origin/main 2>/dev/null)
  AGE=$(git log -1 --format="%cr" $branch 2>/dev/null)
  echo "  $branch — $BEHIND commits behind main, last activity: $AGE"
done
```

**If more than 3 outstanding branches:**
> WARNING: There are $BRANCHES outstanding feature branches. New work will increase divergence risk.

Ask the user whether to proceed or address the backlog.

**If any branch is >50 commits behind main:**
> WARNING: Branch `<name>` is <N> commits behind main and likely stale. Consider deleting it or rebasing.

---

## Pipeline Mode Workflow

**Role: Push branch and signal review. Do NOT create PRs or merge.**

### Pipeline Overview



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


| You DO | You DO NOT |
|--------|------------|
| Implement code | Create PRs |
| Create feature branches | Merge branches |
| Push branches | Close issues |
| Signal "ready for review" | Bump versions |

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


Unless `--inline` is set, execute this workflow in a delegated subagent worktree (not directly in the orchestrator session).

---

### 1. Verify Issue Has Complete Instructions (BLOCKING)

**Before writing ANY code, verify the issue includes ALL of these:**
- [ ] Numbered implementation steps (not just "hints" or "approach")
- [ ] Files to modify with specific purpose for each
- [ ] Architectural decisions already made (not left for you to decide)
- [ ] Test cases specified

**If ANY item is missing:**
1. Comment on issue: "Implementation blocked: missing [specific items]. Returning to R&P."
3. Exit the stage: `pat pipeline exit --stage "implement" --issue <number> --start-time $IMPL_START_TIME --result "Blocked: incomplete instructions, returned to research" --model "<model name and version>"`
4. **STOP** — do not proceed

**You are an IMPLEMENTER, not a designer.** Execute the plan, not create one.

### 2. Read Implementation Context

```bash
# Check for parent epic
review the issue: <parent-epic-number>

# Check dependency issues (may contain credentials, setup, constraints)
review the issue: <dependency-number>
```

### 3. Check Project Memory


**REQUIRED: Rate every search result** — After using (or deciding not to use) each result, run:

### 4. Post Entry Comment



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

Replace `<Stage>` with `Implement`.

### 5. Create Feature Branch


**Default (worktree — isolated environment for parallel work):**

```bash
# From main repository
git fetch origin

# Create worktree (creates both worktree and branch)
git worktree add .claude/worktrees/issue-<number> -b feature/issue-<number>-description origin/main

# post-checkout hook auto-pushes the branch — verify remote exists
git -C .claude/worktrees/issue-<number> rev-parse --verify origin/feature/issue-<number>-description

# Move to the worktree
cd .claude/worktrees/issue-<number>
```

**Alternative: No worktree (work directly in main repo)**

Use this for implement or merge stages that must run in the main working tree:

```bash
# From main repository
git fetch origin

# Create and switch to feature branch
git checkout -b feature/issue-<number>-description origin/main
```

**Example:**
```bash
# Default (worktree):
git worktree add .claude/worktrees/issue-123 -b feature/issue-123-add-feature origin/main
git -C .claude/worktrees/issue-123 rev-parse --verify origin/feature/issue-123-add-feature
cd .claude/worktrees/issue-123

# Without worktree:
git checkout -b feature/issue-123-add-feature origin/main
```

**Worktree benefits:**
- Isolated environment for this issue
- Parallel work possible (multiple LLMs on different issues)
- Main repo stays clean on main branch



### 6. Verify Backups (if issue touches databases or infrastructure)


If the issue involves database changes (migrations, data manipulation), Docker/service config, or non-git state, verify a recent Kopia backup exists before proceeding. See `docs/kopia-backup-reference.md` for full API details.

```bash
# Check backup freshness for all sources
curl -s -u jpierce:obese6locals7hawkes9SVEN \
  'http://192.168.54.43:51515/api/v1/sources' \
  | python3 -c "
import json, sys
from datetime import datetime, timezone
data = json.load(sys.stdin)
for s in data.get('sources', []):
    path = s['source']['path']
    last = s.get('lastSnapshot', {}).get('startTime', 'never')
    if last != 'never':
        dt = datetime.fromisoformat(last.replace('Z', '+00:00'))
        age_hrs = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
        status = 'FRESH' if age_hrs < 24 else 'STALE'
        print(f'{status:5s}  {age_hrs:6.1f}h ago  {path}')
    else:
        print(f'NEVER  {\"\":>7s}  {path}')
"
```

| What the Issue Touches | Backup Source to Check | If STALE (>24h) |
|------------------------|----------------------|-----------------|
| Database (PostgreSQL, SQLite) | `/mnt/backups` | Trigger snapshot before proceeding |
| Docker stacks/volumes | `/mnt/stacks` | Trigger snapshot before proceeding |
| Non-git config/state | `/mnt/dev` or relevant source | Trigger snapshot before proceeding |
| Code files only (git-tracked) | N/A | Git repo + `/restore-point` is sufficient |

**If a backup is stale, trigger a snapshot and wait:**
```bash
# Trigger snapshot (WARNING: triggers ALL sources)
curl -s -u jpierce:obese6locals7hawkes9SVEN -X POST \
  'http://192.168.54.43:51515/api/v1/sources/upload' \
  -H 'Content-Type: application/json' \
  -d '{"source":{"host":"kopia","userName":"jpierce","path":"/mnt/backups"}}'

# Wait for completion
while curl -s -u jpierce:obese6locals7hawkes9SVEN \
  'http://192.168.54.43:51515/api/v1/tasks' \
  | python3 -c "
import json, sys
tasks = json.load(sys.stdin).get('tasks', [])
running = [t for t in tasks if t['status'] == 'RUNNING' and t['kind'] == 'Snapshot']
sys.exit(0 if running else 1)
" 2>/dev/null; do sleep 10; done
echo "Backup complete."
```

**Do NOT proceed with database or infrastructure changes until backup is confirmed FRESH.**

### 7. Implement

Follow ALL architectural standards — no hardcoded values, fail-fast, use existing helpers from `docs/python-functions-reference.md`, files under ~500 lines, DRY.

### 8. Test


ALL test types are **MANDATORY**. There are **NO EXCEPTIONS**. Ever.

| # | Test Type | Command | Required |
|---|-----------|---------|----------|
| 1 | **ruff** | `python -m ruff check $(git diff --name-only origin/main...HEAD -- '*.py')` | ALWAYS - NO EXCEPTIONS |
| 2 | **pytest** | `python -m pytest tests/unit/test_<module>.py -v` | ALWAYS - NO EXCEPTIONS |
| 3 | **Playwright** | `python -m pytest tests/browser/test_<relevant>.py` | ALWAYS for webapp - NO EXCEPTIONS |

**"Skipping" tests is not acceptable. Ever.**

### What is BANNED — NO EXCEPTIONS



**Mocks are BANNED. No exceptions.**

| Banned Pattern | Why |
|----------------|-----|
| `unittest.mock` / `@patch` / `MagicMock` | Replaces real behavior with fake behavior |
| `pytest-mock` / `mocker.patch()` | Same — just a different API |
| `Mock()` / `MagicMock()` | Fake objects that hide real failures |
| Dry-run mode as test substitute | Tests must run real commands |

**The pre-commit hook BLOCKS commits containing mock patterns.**

Tests must use:
- Real `subprocess.run()` for CLI commands
- Real filesystem operations (use `tmp_path`)
- Real database/network calls (or `pytest.skip` if genuinely unavailable)


### Testing Checklist - ALL MUST PASS
- [ ] Lint tests pass - NO EXCEPTIONS
- [ ] pytest passes (real execution, no mocks) - NO EXCEPTIONS
- [ ] Browser tests pass (webapp) - NO EXCEPTIONS
- [ ] **Test log analysis complete** (see below)
- [ ] **Functional verification complete** (see below)

### Test Selection Strategy

**Run only tests relevant to your changes — not the full suite.**

```bash
# 1. Find the test file for your changed module
#    Source: src/package/module/file.py -> Test: tests/unit/module/test_file.py
#    Use Glob to search: tests/unit/**/*<keyword>*.py

# 2. Run specific test file for the module you modified
python -m pytest tests/unit/test_<module>.py -v

# 3. Run related component directory
python -m pytest tests/unit/<component>/ -v

# 4. Pattern match by feature name
python -m pytest tests/unit/ -k "<feature_name>" -v
```

**Full regression is handled automatically** — the pre-commit hook runs `python -m pytest tests/unit/ --testmon`, which re-runs only tests affected by your changes.

### CLI Tests — MANDATORY (NO EXCEPTIONS)

You MUST write CLI tests that:
- [ ] Test the specific CLI command/feature you implemented
- [ ] Test previous functionality in the same module (regression)
- [ ] Test adjacent functionality (any code that calls your changed code)

**What counts as a test:**
- Real `subprocess.run()` executing actual CLI commands
- Real filesystem operations (use `tmp_path`)
- Real database calls (or `pytest.skip` if unavailable)
- Real network calls (or `pytest.skip` if unavailable)

See `.claude/E2E_TEST_STANDARDS.md` for templates and examples.

### Browser Tests — MANDATORY (NO EXCEPTIONS for webapp)

You MUST write browser tests that:
- [ ] Test the specific web UI feature you implemented
- [ ] Test previous functionality (regression)
- [ ] Test adjacent functionality (any web route that uses your changed code)

**What counts as a browser test:**
- Playwright test with real browser using Playwright fixtures (`browser_page`, `live_page`, `page`)
- Real API calls with response data verification
- State change verification (not just element visibility)

**Browser tests MUST use Playwright fixtures.** See `.claude/BROWSER_TEST_STANDARDS.md` and `.claude/E2E_TEST_STANDARDS.md` for details.

### Coverage Scope — MANDATORY

When you modify `module/feature.py`, you MUST test:



**Coverage scope — test all three rings:**

| Scope | What to Test |
|-------|--------------|
| **Direct** | The specific feature/function you changed |
| **Previous** | Existing features in the same module (regression) |
| **Adjacent** | All callers/consumers of your changed code |

Find adjacent code:
```bash
for file in $(git diff origin/main --name-only | grep -E '^src/.*\.py$'); do
  module=$(basename "$file" .py)
  grep -r "from.*${module} import\|import.*${module}" src/ tests/ --include="*.py" | grep -v "__pycache__"
done
```


### Test Log Analysis (REQUIRED)

**After running tests, analyze the output for red flags that passing tests can hide.**

```bash
# Re-run targeted tests capturing output for analysis
python -m pytest tests/unit/test_<module>.py -v 2>&1 | tee /tmp/test-output.log

# Check for skipped tests and their reasons
grep -iE "SKIPPED|skip" /tmp/test-output.log

# Check for warnings that indicate problems
grep -iE "warning|deprecat" /tmp/test-output.log

# Check for error output mixed in with passes
grep -iE "error|exception|traceback" /tmp/test-output.log | grep -v "PASSED"
```

**Pass/fail criteria:**

| Finding | Verdict | Action |
|---------|---------|--------|
| All tests pass, no skips, no warnings | PASS | Proceed |
| Tests skipped — missing resource that SHOULD be available | **FAIL** | Fix the missing resource |
| Tests skipped — resource genuinely unavailable | PASS with note | Document why skip is acceptable |
| Warnings about deprecated APIs you just introduced | **FAIL** | Fix the deprecation before proceeding |
| Flaky test indicators (different results on re-run) | **FAIL** | Investigate and fix flakiness |
| Runtime errors in stderr despite tests passing | **FAIL** | Investigate — passing tests may not cover the error path |

### Application Log Monitoring — MANDATORY (NO EXCEPTIONS)

**You MUST check the application's own log files for errors that don't surface in test output or console.**

#### Capture Baseline (BEFORE running tests/commands)

```bash
if [ -z "$LOG_DIR" ] || [ ! -d "$LOG_DIR" ]; then
    LOG_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/logs"
fi
LOG_FILE=""
if [ -d "$LOG_DIR" ]; then
    LOG_FILE=$(ls -t "$LOG_DIR"/*.log 2>/dev/null | head -1)
fi
if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
    LOG_BASELINE=$(wc -l < "$LOG_FILE")
    echo "Log baseline: $LOG_BASELINE lines in $LOG_FILE"
else
    echo "No application log file found (file logging may be disabled)"
fi
```

#### Check for New Errors (AFTER running tests/commands)

```bash
if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
    CURRENT_LINES=$(wc -l < "$LOG_FILE")
    NEW_COUNT=$((CURRENT_LINES - LOG_BASELINE))
    echo "New log entries since baseline: $NEW_COUNT"
    if [ "$NEW_COUNT" -gt 0 ]; then
        tail -n +"$((LOG_BASELINE + 1))" "$LOG_FILE" \
            | grep -iE "error|exception|traceback|critical|fatal|warning" \
            | head -20
    fi
fi
```

| Finding | Verdict | Action |
|---------|---------|--------|
| No log file (file logging disabled) | PASS | Not applicable — proceed |
| No new entries during testing | PASS | Proceed |
| New entries, none are ERROR/EXCEPTION/CRITICAL/FATAL | PASS with note | Document warnings |
| New ERROR/EXCEPTION entries caused by your changes | **FAIL** | Fix the errors before proceeding |
| New ERROR entries from pre-existing issues | PASS with note | File pre-existing issue, document |

### 9. Functional Verification


**You MUST run the feature with real arguments AND verify the end state across all affected systems.**

This is a homelab environment — dev IS production. "The command ran without errors" is NOT verification. You must confirm the **outcome** is correct in every system the change touches.

### The Two-Step Rule

Every functional verification has TWO parts:

1. **Execute:** Run the command/action with real arguments
2. **Confirm outcome:** Independently verify the end state is correct

| Change Type | What to Run | Outcome to Verify |
|-------------|-------------|-------------------|
| CLI feature | Run the command with real arguments | Confirm the result is correct (check files, repos, databases, services) |
| Bug fix | Reproduce the original scenario | Confirm the bug is gone AND no regression in related behavior |
| Label/issue mgmt | Run the label or issue command | Verify labels exist in ALL target repos, verify ALL affected issues |
| API change | Call the endpoint with real data | Verify response data is correct AND downstream consumers still work |
| Multi-repo change | Run the command | Verify the change landed correctly in EVERY affected repo |

**Example — label sync change:**
```
       in each. Checked 5 issues with labels — all correct."  <- both steps
```

#### What does NOT count as functional verification

- "Tests pass" — tests verify code correctness, not that the feature works end-to-end
- "Code looks correct" — reading code is not running code
- "Browser tests pass" — automated tests are necessary but not sufficient
- "Command ran without errors" — exit code 0 does not mean the outcome is correct
- "Checked one repo" — if the change affects multiple repos/systems, check ALL of them

### 10. Pre-Existing Issue Filing


**Every problem you encounter MUST result in either a fix or a filed issue. No exceptions. No asking permission.**

### Step 1: Verify the cause (REQUIRED before categorizing)

**NEVER assume a failure is pre-existing.** You MUST verify:

```bash
# Run the failing test on the base branch to confirm it's pre-existing
git stash && git checkout origin/main
python -m pytest tests/unit/test_<failing>.py::test_name -v
git checkout - && git stash pop
```

| Result | Conclusion | Action |
|--------|------------|--------|
| Fails on base branch too | Pre-existing | File issue, continue |
| Only fails on your branch | Your bug | Fix it |
| Cannot verify (infrastructure) | Unknown | State explicitly, file issue with note |

### Step 2: Take action (MANDATORY — zero exceptions)

| Situation | Action |
|-----------|--------|
| Pre-existing test failure | **File issue immediately**, continue |
| Dirty files from previous work | **File issue**, stash/ignore, continue |
| Lint error in untouched file | **File issue**, continue |
| Test failure caused by your changes | **Fix it** (this is your bug) |
| Missing test coverage for existing code | **File issue**, continue |

**How to file:**

**IMPORTANT:** The `--body` MUST contain real details — the actual error output, file path, test name, and failure description. Never pass placeholder text like "Describe the issue" as the body.

```bash
# File in current repo (uses template for auto-labels)

# File in a different repo (manual labels — template may not exist)
```

**Then update the working issue:**
```bash
log to docs/superpowers/deferred-fixes.md: "### Pre-Existing Issues Found
During implementation, the following pre-existing issues were discovered and filed:
- #XXXX - Brief description
- #YYYY - Brief description (filed in jpierce/other-repo)
These are NOT related to the current implementation work."
```

Issues filed this way don't need to be super detailed — just enough context for `/research` to pick up later. **Don't let pre-existing issues block your current task.**

### 11. Commit and Push

```bash
git add .
git commit -m "Description (#<issue-number>)"
git fetch origin && git rebase origin/main
git push -u origin <branch-name>
```

### 12. Requirements Cross-Reference (MANDATORY)

- [ ] Re-read the original issue acceptance criteria
- [ ] Re-read the parent epic purpose (if applicable)
- [ ] For EACH acceptance criterion: identify the specific code/test that fulfills it
- [ ] If any criterion is NOT met: implement it before proceeding

### 13. Signal Ready for Review


```bash
log to docs/superpowers/deferred-fixes.md: "## Ready for Review
**Branch:** \`<branch-name>\`
### Requirements Fulfilled
- **Issue acceptance criteria:**
  - [criterion 1]: met by [specific code/test]
  - [criterion 2]: met by [specific code/test]
- **Parent epic purpose:** [state the epic goal and how this implementation serves it]
- **Dependency context used:** [note any credentials, config, or constraints from dependency issues]
### Changes
- [List changes]
### Files
- \`path/file.py\` - description
### Functional Verification
- **Command/Action:** [exact command or action performed]
- **Result:** [what happened — paste output or describe observed behavior]
- **Outcome Confirmed:** [what you checked AFTER the command to verify the end state]
- **Scope of Impact:** [list all systems/repos/services affected by this change]
- **All Affected Systems Verified:** [yes/no — if no, explain what was not checked and why]
### E2E Test Coverage
#### CLI Tests Added
- \`tests/cli/test_xxx.py::test_name\` - [what it tests]
- Coverage: [direct | previous | adjacent]
#### Browser Tests Added (webapp)
- \`tests/browser/test_xxx.py::test_name\` - [what it tests]
- Coverage: [direct | previous | adjacent]
### Test Results (for downstream phases)
- **Commit SHA:** \`$(git rev-parse HEAD)\`
- **ruff:** PASS
- **pytest:** PASS (X passed, Y skipped)
- **Pre-commit testmon:** PASS
### Pre-Existing Issues Filed (if any)
- #XXXX - Brief description
- #YYYY - Brief description
#### Confirmation
- [ ] NO mock patterns (unittest.mock, @patch, MagicMock, pytest-mock) — BANNED
- [ ] Previous features regression tested
- [ ] All callers/consumers of changed code tested"
```

**The Requirements Fulfilled section is MANDATORY.** The Reviewer will reject the handoff if it is missing.

**The Functional Verification section is MANDATORY.** The Reviewer will reject the handoff if it is missing or vague.

**The E2E Test Coverage section is MANDATORY.** The Reviewer will reject the handoff if tests are not listed.

### 14. Update State, Post Exit Comment, and Save Context

```bash
```



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


Replace `<stage>` with `implement`, `<number>` with the issue number, `<result summary>` with `Ready for Review. Branch: \`<branch-name>\``, and `<model name and version>` with the current model.

```bash
```

### 15. STOP

Wait for Reviewer. Do NOT create PR or merge.

---

## Standalone Mode Workflow

**Role: Full end-to-end — branch, implement, test, PR, merge, close.**

### 1. Review and Verify Issue

```bash
review the issue: <issue-number>
```

Verify issue has implementation instructions (same checks as Pipeline step 1). If incomplete, return to R&P.

### 2. Read Context and Check Memory

Same as Pipeline steps 2-3.

### 3. Post Entry Comment

Same as Pipeline step 4 — post Pipeline Activity entry comment with `Start Implement` action and capture `IMPL_START_TIME`.

### 4. Create Feature Branch


**Default (worktree — isolated environment for parallel work):**

```bash
# From main repository
git fetch origin

# Create worktree (creates both worktree and branch)
git worktree add .claude/worktrees/issue-<number> -b feature/issue-<number>-description origin/main

# post-checkout hook auto-pushes the branch — verify remote exists
git -C .claude/worktrees/issue-<number> rev-parse --verify origin/feature/issue-<number>-description

# Move to the worktree
cd .claude/worktrees/issue-<number>
```

**Alternative: No worktree (work directly in main repo)**

Use this for implement or merge stages that must run in the main working tree:

```bash
# From main repository
git fetch origin

# Create and switch to feature branch
git checkout -b feature/issue-<number>-description origin/main
```

**Example:**
```bash
# Default (worktree):
git worktree add .claude/worktrees/issue-123 -b feature/issue-123-add-feature origin/main
git -C .claude/worktrees/issue-123 rev-parse --verify origin/feature/issue-123-add-feature
cd .claude/worktrees/issue-123

# Without worktree:
git checkout -b feature/issue-123-add-feature origin/main
```

**Worktree benefits:**
- Isolated environment for this issue
- Parallel work possible (multiple LLMs on different issues)
- Main repo stays clean on main branch



### 5. Verify Backups (if applicable)


If the issue involves database changes (migrations, data manipulation), Docker/service config, or non-git state, verify a recent Kopia backup exists before proceeding. See `docs/kopia-backup-reference.md` for full API details.

```bash
# Check backup freshness for all sources
curl -s -u jpierce:obese6locals7hawkes9SVEN \
  'http://192.168.54.43:51515/api/v1/sources' \
  | python3 -c "
import json, sys
from datetime import datetime, timezone
data = json.load(sys.stdin)
for s in data.get('sources', []):
    path = s['source']['path']
    last = s.get('lastSnapshot', {}).get('startTime', 'never')
    if last != 'never':
        dt = datetime.fromisoformat(last.replace('Z', '+00:00'))
        age_hrs = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
        status = 'FRESH' if age_hrs < 24 else 'STALE'
        print(f'{status:5s}  {age_hrs:6.1f}h ago  {path}')
    else:
        print(f'NEVER  {\"\":>7s}  {path}')
"
```

| What the Issue Touches | Backup Source to Check | If STALE (>24h) |
|------------------------|----------------------|-----------------|
| Database (PostgreSQL, SQLite) | `/mnt/backups` | Trigger snapshot before proceeding |
| Docker stacks/volumes | `/mnt/stacks` | Trigger snapshot before proceeding |
| Non-git config/state | `/mnt/dev` or relevant source | Trigger snapshot before proceeding |
| Code files only (git-tracked) | N/A | Git repo + `/restore-point` is sufficient |

**If a backup is stale, trigger a snapshot and wait:**
```bash
# Trigger snapshot (WARNING: triggers ALL sources)
curl -s -u jpierce:obese6locals7hawkes9SVEN -X POST \
  'http://192.168.54.43:51515/api/v1/sources/upload' \
  -H 'Content-Type: application/json' \
  -d '{"source":{"host":"kopia","userName":"jpierce","path":"/mnt/backups"}}'

# Wait for completion
while curl -s -u jpierce:obese6locals7hawkes9SVEN \
  'http://192.168.54.43:51515/api/v1/tasks' \
  | python3 -c "
import json, sys
tasks = json.load(sys.stdin).get('tasks', [])
running = [t for t in tasks if t['status'] == 'RUNNING' and t['kind'] == 'Snapshot']
sys.exit(0 if running else 1)
" 2>/dev/null; do sleep 10; done
echo "Backup complete."
```

**Do NOT proceed with database or infrastructure changes until backup is confirmed FRESH.**

### 6. Implement

Follow ALL architectural standards. Create TodoWrite from issue instructions for 3+ step tasks.

### 7. Test


ALL test types are **MANDATORY**. There are **NO EXCEPTIONS**. Ever.

| # | Test Type | Command | Required |
|---|-----------|---------|----------|
| 1 | **ruff** | `python -m ruff check $(git diff --name-only origin/main...HEAD -- '*.py')` | ALWAYS - NO EXCEPTIONS |
| 2 | **pytest** | `python -m pytest tests/unit/test_<module>.py -v` | ALWAYS - NO EXCEPTIONS |
| 3 | **Playwright** | `python -m pytest tests/browser/test_<relevant>.py` | ALWAYS for webapp - NO EXCEPTIONS |

**"Skipping" tests is not acceptable. Ever.**

### What is BANNED — NO EXCEPTIONS



**Mocks are BANNED. No exceptions.**

| Banned Pattern | Why |
|----------------|-----|
| `unittest.mock` / `@patch` / `MagicMock` | Replaces real behavior with fake behavior |
| `pytest-mock` / `mocker.patch()` | Same — just a different API |
| `Mock()` / `MagicMock()` | Fake objects that hide real failures |
| Dry-run mode as test substitute | Tests must run real commands |

**The pre-commit hook BLOCKS commits containing mock patterns.**

Tests must use:
- Real `subprocess.run()` for CLI commands
- Real filesystem operations (use `tmp_path`)
- Real database/network calls (or `pytest.skip` if genuinely unavailable)


### Testing Checklist - ALL MUST PASS
- [ ] Lint tests pass - NO EXCEPTIONS
- [ ] pytest passes (real execution, no mocks) - NO EXCEPTIONS
- [ ] Browser tests pass (webapp) - NO EXCEPTIONS
- [ ] **Test log analysis complete** (see below)
- [ ] **Functional verification complete** (see below)

### Test Selection Strategy

**Run only tests relevant to your changes — not the full suite.**

```bash
# 1. Find the test file for your changed module
#    Source: src/package/module/file.py -> Test: tests/unit/module/test_file.py
#    Use Glob to search: tests/unit/**/*<keyword>*.py

# 2. Run specific test file for the module you modified
python -m pytest tests/unit/test_<module>.py -v

# 3. Run related component directory
python -m pytest tests/unit/<component>/ -v

# 4. Pattern match by feature name
python -m pytest tests/unit/ -k "<feature_name>" -v
```

**Full regression is handled automatically** — the pre-commit hook runs `python -m pytest tests/unit/ --testmon`, which re-runs only tests affected by your changes.

### CLI Tests — MANDATORY (NO EXCEPTIONS)

You MUST write CLI tests that:
- [ ] Test the specific CLI command/feature you implemented
- [ ] Test previous functionality in the same module (regression)
- [ ] Test adjacent functionality (any code that calls your changed code)

**What counts as a test:**
- Real `subprocess.run()` executing actual CLI commands
- Real filesystem operations (use `tmp_path`)
- Real database calls (or `pytest.skip` if unavailable)
- Real network calls (or `pytest.skip` if unavailable)

See `.claude/E2E_TEST_STANDARDS.md` for templates and examples.

### Browser Tests — MANDATORY (NO EXCEPTIONS for webapp)

You MUST write browser tests that:
- [ ] Test the specific web UI feature you implemented
- [ ] Test previous functionality (regression)
- [ ] Test adjacent functionality (any web route that uses your changed code)

**What counts as a browser test:**
- Playwright test with real browser using Playwright fixtures (`browser_page`, `live_page`, `page`)
- Real API calls with response data verification
- State change verification (not just element visibility)

**Browser tests MUST use Playwright fixtures.** See `.claude/BROWSER_TEST_STANDARDS.md` and `.claude/E2E_TEST_STANDARDS.md` for details.

### Coverage Scope — MANDATORY

When you modify `module/feature.py`, you MUST test:



**Coverage scope — test all three rings:**

| Scope | What to Test |
|-------|--------------|
| **Direct** | The specific feature/function you changed |
| **Previous** | Existing features in the same module (regression) |
| **Adjacent** | All callers/consumers of your changed code |

Find adjacent code:
```bash
for file in $(git diff origin/main --name-only | grep -E '^src/.*\.py$'); do
  module=$(basename "$file" .py)
  grep -r "from.*${module} import\|import.*${module}" src/ tests/ --include="*.py" | grep -v "__pycache__"
done
```


### Test Log Analysis (REQUIRED)

**After running tests, analyze the output for red flags that passing tests can hide.**

```bash
# Re-run targeted tests capturing output for analysis
python -m pytest tests/unit/test_<module>.py -v 2>&1 | tee /tmp/test-output.log

# Check for skipped tests and their reasons
grep -iE "SKIPPED|skip" /tmp/test-output.log

# Check for warnings that indicate problems
grep -iE "warning|deprecat" /tmp/test-output.log

# Check for error output mixed in with passes
grep -iE "error|exception|traceback" /tmp/test-output.log | grep -v "PASSED"
```

**Pass/fail criteria:**

| Finding | Verdict | Action |
|---------|---------|--------|
| All tests pass, no skips, no warnings | PASS | Proceed |
| Tests skipped — missing resource that SHOULD be available | **FAIL** | Fix the missing resource |
| Tests skipped — resource genuinely unavailable | PASS with note | Document why skip is acceptable |
| Warnings about deprecated APIs you just introduced | **FAIL** | Fix the deprecation before proceeding |
| Flaky test indicators (different results on re-run) | **FAIL** | Investigate and fix flakiness |
| Runtime errors in stderr despite tests passing | **FAIL** | Investigate — passing tests may not cover the error path |

### Application Log Monitoring — MANDATORY (NO EXCEPTIONS)

**You MUST check the application's own log files for errors that don't surface in test output or console.**

#### Capture Baseline (BEFORE running tests/commands)

```bash
if [ -z "$LOG_DIR" ] || [ ! -d "$LOG_DIR" ]; then
    LOG_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/logs"
fi
LOG_FILE=""
if [ -d "$LOG_DIR" ]; then
    LOG_FILE=$(ls -t "$LOG_DIR"/*.log 2>/dev/null | head -1)
fi
if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
    LOG_BASELINE=$(wc -l < "$LOG_FILE")
    echo "Log baseline: $LOG_BASELINE lines in $LOG_FILE"
else
    echo "No application log file found (file logging may be disabled)"
fi
```

#### Check for New Errors (AFTER running tests/commands)

```bash
if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
    CURRENT_LINES=$(wc -l < "$LOG_FILE")
    NEW_COUNT=$((CURRENT_LINES - LOG_BASELINE))
    echo "New log entries since baseline: $NEW_COUNT"
    if [ "$NEW_COUNT" -gt 0 ]; then
        tail -n +"$((LOG_BASELINE + 1))" "$LOG_FILE" \
            | grep -iE "error|exception|traceback|critical|fatal|warning" \
            | head -20
    fi
fi
```

| Finding | Verdict | Action |
|---------|---------|--------|
| No log file (file logging disabled) | PASS | Not applicable — proceed |
| No new entries during testing | PASS | Proceed |
| New entries, none are ERROR/EXCEPTION/CRITICAL/FATAL | PASS with note | Document warnings |
| New ERROR/EXCEPTION entries caused by your changes | **FAIL** | Fix the errors before proceeding |
| New ERROR entries from pre-existing issues | PASS with note | File pre-existing issue, document |

### 8. Functional Verification


**You MUST run the feature with real arguments AND verify the end state across all affected systems.**

This is a homelab environment — dev IS production. "The command ran without errors" is NOT verification. You must confirm the **outcome** is correct in every system the change touches.

### The Two-Step Rule

Every functional verification has TWO parts:

1. **Execute:** Run the command/action with real arguments
2. **Confirm outcome:** Independently verify the end state is correct

| Change Type | What to Run | Outcome to Verify |
|-------------|-------------|-------------------|
| CLI feature | Run the command with real arguments | Confirm the result is correct (check files, repos, databases, services) |
| Bug fix | Reproduce the original scenario | Confirm the bug is gone AND no regression in related behavior |
| Label/issue mgmt | Run the label or issue command | Verify labels exist in ALL target repos, verify ALL affected issues |
| API change | Call the endpoint with real data | Verify response data is correct AND downstream consumers still work |
| Multi-repo change | Run the command | Verify the change landed correctly in EVERY affected repo |

**Example — label sync change:**
```
       in each. Checked 5 issues with labels — all correct."  <- both steps
```

#### What does NOT count as functional verification

- "Tests pass" — tests verify code correctness, not that the feature works end-to-end
- "Code looks correct" — reading code is not running code
- "Browser tests pass" — automated tests are necessary but not sufficient
- "Command ran without errors" — exit code 0 does not mean the outcome is correct
- "Checked one repo" — if the change affects multiple repos/systems, check ALL of them

### 9. Pre-Existing Issue Filing


**Every problem you encounter MUST result in either a fix or a filed issue. No exceptions. No asking permission.**

### Step 1: Verify the cause (REQUIRED before categorizing)

**NEVER assume a failure is pre-existing.** You MUST verify:

```bash
# Run the failing test on the base branch to confirm it's pre-existing
git stash && git checkout origin/main
python -m pytest tests/unit/test_<failing>.py::test_name -v
git checkout - && git stash pop
```

| Result | Conclusion | Action |
|--------|------------|--------|
| Fails on base branch too | Pre-existing | File issue, continue |
| Only fails on your branch | Your bug | Fix it |
| Cannot verify (infrastructure) | Unknown | State explicitly, file issue with note |

### Step 2: Take action (MANDATORY — zero exceptions)

| Situation | Action |
|-----------|--------|
| Pre-existing test failure | **File issue immediately**, continue |
| Dirty files from previous work | **File issue**, stash/ignore, continue |
| Lint error in untouched file | **File issue**, continue |
| Test failure caused by your changes | **Fix it** (this is your bug) |
| Missing test coverage for existing code | **File issue**, continue |

**How to file:**

**IMPORTANT:** The `--body` MUST contain real details — the actual error output, file path, test name, and failure description. Never pass placeholder text like "Describe the issue" as the body.

```bash
# File in current repo (uses template for auto-labels)

# File in a different repo (manual labels — template may not exist)
```

**Then update the working issue:**
```bash
log to docs/superpowers/deferred-fixes.md: "### Pre-Existing Issues Found
During implementation, the following pre-existing issues were discovered and filed:
- #XXXX - Brief description
- #YYYY - Brief description (filed in jpierce/other-repo)
These are NOT related to the current implementation work."
```

Issues filed this way don't need to be super detailed — just enough context for `/research` to pick up later. **Don't let pre-existing issues block your current task.**

### 10. Commit, Push, and Finish

```bash
git add .
git commit -m "Description (#<issue-number>)"
git fetch origin && git rebase origin/main
git push -u origin <branch-name>
```


### 11. Post Exit Comment and Save Context


---

## Quick Fix Mode Workflow

**Role: Minimal — fix, commit, done.**

### 1. Get Issue
```bash
review the issue: <issue-number>
```

### 2. Execute the Fix

- Read the relevant file(s)
- Make the required change — keep it minimal and focused
- Verify the diff — ensure only intended changes were made

### 3. Commit Using Finish Workflow

**If the change is non-code (markdown, templates, docs, config):**
```bash
```

**If the change touches code (.py, .js, etc.):**
```bash
```

This creates a branch, commits, pushes, creates PR, merges, and cleans up automatically.

---

## If Changes Requested (Pipeline mode)

1. Make fixes
2. Push to same branch
3. Comment "Changes addressed, ready for re-review"
