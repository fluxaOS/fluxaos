# Git Cleanup — Subagent A Reference

Audit branches and stash entries. Report findings only — do NOT delete anything.

You will be given a `WORKTREE_BRANCHES` list. Any branch in that list is **excluded from all findings** —
it is checked out in an active worktree and must not be flagged.

---

## Check 1: Merged Branches

Branches already merged into main are safe to delete. Find them all.

```bash
# Local merged branches (excluding main)
git branch --merged main --format='%(refname:short)' 2>/dev/null | grep -v '^main$'

# Remote merged branches (excluding main, HEAD)
git branch -r --merged origin/main --format='%(refname:short)' 2>/dev/null | grep -vE '^origin/(main|HEAD)$'
```

- Exclude any branch in `WORKTREE_BRANCHES`
- Severity: **LOW** (safe, already merged)
- Recommended action: Delete local + remote

---

## Check 2: Stale Unmerged Branches

Branches not merged into main with last commit older than 30 days.

```bash
# Local unmerged branches with dates
git branch --no-merged main --format='%(refname:short) %(committerdate:iso8601)' 2>/dev/null

# Remote unmerged branches with dates
git branch -r --no-merged origin/main --format='%(refname:short) %(committerdate:iso8601)' 2>/dev/null
```

- Exclude `origin/main`, `origin/HEAD`, and `WORKTREE_BRANCHES`
- Flag branches with last commit **>30 days ago**
- **Before flagging:** If the branch name contains an issue number, check the issue state:
  ```bash
  ISSUE_NUM=$(echo "<branch>" | grep -oP 'issue-\K[0-9]+')
  if [ -n "$ISSUE_NUM" ]; then
    ISSUE_STATE=$(review the issue: "$ISSUE_NUM" --format json 2>/dev/null \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['state'])" 2>/dev/null)
  fi
  ```
  - If `ISSUE_STATE` is NOT `closed`: mark as **PROTECTED** — do NOT flag for deletion regardless of age
  - If `ISSUE_STATE` is `closed` (or no linked issue): proceed with normal age-based flagging
- Severity: **MEDIUM** (unmerged work may be lost)
- Recommended action: Delete local + remote (user confirmation required)

---

## Check 3: Git Stash List Items (Resolve All)

Capture all stash entries so the main agent can explicitly resolve each one during execution.

```bash
git stash list --format='%gd | %ci | %gs' 2>/dev/null
```

- Parse the date from `%ci` field
- Flag **all** stash entries from `git stash list`
- Severity guidance:
  - **MEDIUM** for stashes older than **14 days**
  - **LOW** for stashes 14 days old or newer
- Recommended action: Resolve stash item (drop, apply, pop, or keep with reason)

---

## Check 4: Orphaned Branches (Issue Cross-Reference)

Unmerged branches whose linked issues are closed — the work is done but the branch lingers.

For each unmerged branch (from Check 2 results, plus any not yet flagged):

1. **Extract issue number** from branch name:
   - Pattern `issue-<N>` anywhere → extract N
   - Pattern `*-<N>` at end of name → extract N
   - No number → skip (handled by age-based Check 2)

2. **Check issue status:**
   ```bash
   review the issue: <N>
   ```
   Look for `State: OPEN` vs `State: CLOSED`

3. **Check remote existence:**
   ```bash
   git ls-remote --heads origin <branch>
   ```

4. **Classify:**

   | Remote | Issue | Severity | Action |
   |--------|-------|----------|--------|
   | Deleted | Closed | **HIGH** | Safe to delete — PR merged & cleaned |
   | Deleted | Open | **MEDIUM** | Flag for review — PR closed without merge? |
   | Exists | Closed | **HIGH** | Cleanup — issue done, branch lingering |
   | Exists | Open | — | Active work, skip |

---

## Output Format

Return your findings using this exact structure:

```markdown
## Git Cleanup Findings

### Summary
- Total items checked: N
- Items flagged: N
- Breakdown: CRITICAL: N, HIGH: N, MEDIUM: N, LOW: N

### Findings

| # | Severity | Item | Description | Recommended Action |
|---|----------|------|-------------|--------------------|
| 1 | LOW | branch: feature/done | Merged into main | Delete local + remote |
| 2 | MEDIUM | branch: fix/old-thing | Last commit 45 days ago, unmerged | Delete (user confirm) |
| 3 | MEDIUM | stash@{3} | 21 days old: "WIP login" | Resolve stash item (drop/apply/pop/keep) |
| 4 | HIGH | branch: fix/issue-1234 | Issue #1234 is CLOSED, branch exists | Delete local + remote |
```

If no findings in a check, note it: "No merged branches found." etc.
