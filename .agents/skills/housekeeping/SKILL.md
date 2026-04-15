---
name: "housekeeping"
description: "Project maintenance that spawns parallel subagents to audit git branches, worktrees, and issues/PRs — then presents a unified summary before taking any action. Detects stale worktrees, duplicate/stale issues, merged branches, orphaned branches, and more. Use when the user asks for project cleanup, housekeeping, maintenance, hygiene, or wants to tidy up branches, worktrees, issues, or PRs. Also invoked by /end-of-day as part of the end-of-session cleanup ritual."
---
# Project Housekeeping

Spawns three parallel subagents to audit different housekeeping domains, collects their findings
into a unified report, and presents it to the user for approval before taking any destructive actions.

## Usage

```
/housekeeping                    # Full housekeeping on current project
/housekeeping --dry-run          # Report only, skip action prompts
```

**Arguments:** `$ARGUMENTS`

---

## Critical Constraints

**This repository uses Forgejo (NOT GitHub)**
- NEVER use: `gh` or `tea` commands

> (`forgejo` | `psql`; default: `forgejo`). Projects using the psql backend
> (e.g. PAT) should pass `--backend psql` or set `issue.backend_default`
> in `.fhc-config.json`. Note: `bulk`, `move`, and `report` subcommands
> do not yet support psql (see #2520).

---

## Step 0: Pre-Flight

Parse arguments:
- **`--dry-run`** → set DRY_RUN=true (report only, no action prompts)
- No arguments → full housekeeping

Run pre-flight checks in the current project directory:

```bash
# Ensure we're on main and up to date
git fetch origin --quiet
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  git checkout main 2>/dev/null || echo "WARN: cannot switch to main (dirty tree)"
fi
git pull origin main --quiet 2>/dev/null

# Build worktree inventory (branches that must NEVER be deleted)
WORKTREE_BRANCHES=$(git worktree list --porcelain | grep '^branch' | sed 's|branch refs/heads/||')
```

Store `WORKTREE_BRANCHES` — pass it to subagents A and B so they exclude active worktree branches.

Announce to the user: "Running housekeeping on [project]. Spawning 3 parallel audits..."

---

## Step 1: Launch Three Parallel Subagents

Spawn all three subagents **in the same message** using the Agent tool so they run concurrently.
Each subagent is an `Explore` type that audits one domain and returns a structured findings report.

Read the reference file for each subagent's detailed instructions before constructing the prompt.

| Subagent | Domain | Reference | Key Focus |
|----------|--------|-----------|-----------|
| **A — Git Cleanup** | Branches & stashes | `references/git-cleanup.md` | Merged branches, stale unmerged (30d), all stash entries requiring resolution, orphaned branches with closed issues |
| **B — Worktree Cleanup** | Worktrees | `references/worktree-cleanup.md` | Stale worktrees (merged, detached, auto-generated), cross-project scan, disk usage |
| **C — Issue Triage** | Issues & PRs | `references/issue-triage.md` | Stale PRs (30d), stale review issues (7d), duplicate/combinable issues, stale open issues |

### Subagent Prompt Template

Each subagent prompt must include:
1. The project path and CLI command (`flu`)
2. The `WORKTREE_BRANCHES` list (for A and B)
3. Instruction to read its reference file for detailed check specs
4. Instruction to return findings in this exact format:

```
## [Domain Name] Findings

### Summary
- Total items checked: N
- Items flagged: N
- Breakdown by severity: CRITICAL: N, HIGH: N, MEDIUM: N, LOW: N

### Findings

| # | Severity | Item | Description | Recommended Action |
|---|----------|------|-------------|--------------------|
| 1 | HIGH | branch: fix/old-thing | Last commit 45 days ago, unmerged | Delete local + remote |
| 2 | MEDIUM | stash@{3} | 21 days old: "WIP login" | Resolve stash item (drop/apply/pop/keep) |
```

Subagents must NOT take any destructive actions — they only audit and report.

---

## Step 2: Collect and Merge Results

Wait for all three subagents to complete. Merge their findings into a single report.

Read `references/report-template.md` for the exact output format.

Build the unified report:
1. Combine all findings into one table, sorted by severity (CRITICAL first)
2. Group by domain for readability
3. Calculate health score based on total flagged items
4. Include per-domain summaries

---

## Step 3: Present Summary to User

Display the full housekeeping report to the user.

If `DRY_RUN=true`, stop here with: "Dry-run complete. No changes made."

If not dry-run, present action groups and ask for confirmation:

```
## Proposed Actions

### Auto-safe (no confirmation needed)
- Delete N merged branches (already in main)
- Prune N stale worktree metadata entries

### Requires Confirmation
- [ ] Delete N stale unmerged branches (30+ days)
- [ ] Resolve N stash list items (`git stash list`)
- [ ] Close N stale PRs (30+ days inactive)
- [ ] Remove N stale worktrees
- [ ] Close N stale/duplicate issues
- [ ] Delete N orphaned branches (closed issues)

Proceed with all proposed actions? (y/n/select)
```

- **y** → execute all actions
- **n** → abort, no changes
- **select** → let user pick which groups to execute

---

## Step 4: Execute Approved Actions

For each approved action group, execute the changes:

**Git cleanup actions** (from subagent A findings):
- Merged branches: `git branch -d` (local), `git push origin --delete` (remote)
- Stale branches: `git branch -D` (local), `git push origin --delete` (remote)
- Stash list items: run `git stash list` and resolve every reported `stash@{N}` with one action:
  - Drop: `git stash drop stash@{N}` (highest index first if dropping multiple)
  - Apply and keep: `git stash apply stash@{N}`
  - Pop and remove: `git stash pop stash@{N}`
  - Keep intentionally: record as skipped with explicit reason
- Orphaned branches: `git branch -D` (local), `git push origin --delete` (remote)

**Worktree cleanup actions** (from subagent B findings):
- Check for unpushed commits first: `git -C <path> log --oneline origin/<branch>..<branch>`
- If clean: `git worktree remove <path>` then `git push origin --delete <branch>` (if merged)
- Prune metadata: `git worktree prune`

**Issue/PR actions** (from subagent C findings):

Record every action taken and every item skipped.

---

## Step 5: Final Report

Present the final summary showing what was actually done:

```markdown
# Housekeeping Complete

**Project:** [name]
**Date:** [today]

## Actions Taken
| Area | Found | Cleaned | Skipped |
|------|-------|---------|---------|
| ... per domain rows ... |

## Health Score: [Clean|Healthy|Needs Attention|Overdue]
```

Health score thresholds:
- **Clean:** 0 remaining flagged items
- **Healthy:** 1-3 remaining
- **Needs Attention:** 4-10 remaining
- **Overdue:** 10+ remaining

---

## Clean State Verification

Run **all four commands in a single shell invocation** and display the combined output exactly as the user would see it:

```bash
git status && git stash list && git branch && git branch -r
```

The ideal clean output looks like:

```
On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
* main
  origin/HEAD -> origin/main
  origin/main
```

Display the raw output verbatim. Then evaluate:

- **PASS** if ALL of the following are true:
  - `git status` shows "nothing to commit, working tree clean"
  - `git stash list` returns empty output (no stash entries)
  - `git branch` shows only `* main` (no other local branches)
  - `git branch -r` shows only `origin/HEAD -> origin/main` and `origin/main` (no other remote branches)

- **Branches/worktrees linked to OPEN issues are NOT failures** — they are expected to remain.
  Any branch or remote ref whose name contains an issue number (e.g. `issue-2625`) where the issue
  is still open should be listed as **PROTECTED (open issue)** and excluded from the PASS/FAIL evaluation.

- **FAIL** if ANY of the following are true (after excluding protected items):
  - Working tree is dirty (modified/untracked/staged files)
  - Any stash entries exist
  - Unexpected local branches remain (not linked to open issues)
  - Unexpected remote branches remain (not linked to open issues)

If **PASS**: print `✓ Git state is clean — housekeeping complete.`

If **FAIL**: print `✗ Git state is NOT clean — review output above and resolve before closing the session.` Do NOT print the "Housekeeping Complete" success summary.
