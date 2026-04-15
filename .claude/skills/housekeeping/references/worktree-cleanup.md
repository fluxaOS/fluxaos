# Worktree Cleanup — Subagent B Reference

Audit git worktrees for staleness and orphaned state. Report findings only — do NOT remove anything.

You will be given a `WORKTREE_BRANCHES` list for reference (these are all active worktrees).

---

## Check 1: Prune Stale Metadata

First, identify worktree references that point to already-deleted directories:

```bash
# Dry-run prune to see what would be cleaned
git worktree prune --dry-run
```

Report any entries that would be pruned.
- Severity: **LOW** (metadata cleanup, no data loss)
- Recommended action: Prune (`git worktree prune`)

---

## Check 2: Stale Worktrees in .claude/worktrees/

List all worktrees and classify each:

```bash
git worktree list --porcelain
```

For each worktree (skip the main repo entry):

### Classification Criteria

1. **Check branch status:**
   ```bash
   # Is branch merged into main?
   git branch --merged main | grep -q '<branch>'

   # Is it a detached HEAD?
   # (shown as "(detached HEAD)" in worktree list)
   ```

2. **Check for uncommitted changes:**
   ```bash
   git -C <worktree-path> status --porcelain
   ```

3. **Check for unpushed commits:**
   ```bash
   git -C <worktree-path> log --oneline origin/<branch>..<branch> 2>/dev/null
   ```

4. **Check branch age (last commit):**
   ```bash
   git -C <worktree-path> log -1 --format='%ci' 2>/dev/null
   ```

5. **Check if auto-generated name:**
   - Pattern: `worktree-agent-*`, `worktree-review-*`, `wt-*`

6. **Check if linked issue is still open (before any deletion):**

   For each worktree whose branch name contains an issue number (e.g. `feature/issue-2450-foo` → issue #2450):
   ```bash
   ISSUE_NUM=$(echo "<branch>" | grep -oP 'issue-\K[0-9]+')
   if [ -n "$ISSUE_NUM" ]; then
     ISSUE_STATE=$(review the issue: "$ISSUE_NUM" --format json 2>/dev/null \
       | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['state'])" 2>/dev/null)
   fi
   ```
   - If `ISSUE_STATE` is NOT `closed`: mark as **PROTECTED** — do NOT flag for deletion
   - If `ISSUE_STATE` is `closed` (or no linked issue): proceed with normal classification

### Classification Table

| Condition | Classification | Severity | Action |
|-----------|---------------|----------|--------|
| Linked issue is OPEN (not closed) | Protected | — | Skip — active work in progress |
| Branch merged into main | Stale | **MEDIUM** | Remove worktree + delete branch |
| Detached HEAD | Stale | **MEDIUM** | Remove worktree |
| Auto-generated name + merged | Stale | **LOW** | Remove worktree + delete branch |
| Auto-generated name + unmerged + no commits in 14d | Likely abandoned | **MEDIUM** | Remove (user confirm) |
| Has uncommitted changes | **Dirty** | **HIGH** | Flag for review — has unsaved work |
| Has unpushed commits | **Unpushed** | **HIGH** | Flag for review — commits not on remote |
| Unmerged feature branch + recent activity | Active | — | Skip |

**Important:** Worktrees with uncommitted changes or unpushed commits must ALWAYS be flagged at HIGH severity. They should never be auto-removed.

**Important:** Worktrees whose linked issue is still open (state != `closed`) must NEVER be flagged for deletion, regardless of age. Mark them as PROTECTED in the findings report.

---

## Check 3: Cross-Project Worktree Scan

If the cleanup script is available, use it to scan across all projects:

```bash
python -m fh_commons.scripts.cleanup --all-projects --dry-run 2>/dev/null
```

If the script is not available or errors, fall back to scanning common project paths:

```bash
# Check for .claude/worktrees/ in sibling project directories
for dir in /mnt/dev/*/; do
  if [ -d "$dir/.claude/worktrees" ]; then
    echo "=== $dir ==="
    ls -la "$dir/.claude/worktrees/" 2>/dev/null
  fi
done
```

Report any stale worktrees found in other projects as informational findings.
- Severity: **LOW** (informational — other projects' cleanup)
- Recommended action: Note for user awareness

---

## Check 4: Disk Usage

For each worktree found, report approximate disk usage:

```bash
du -sh <worktree-path> 2>/dev/null
```

Include total disk usage across all worktrees in the summary. Flag if total exceeds 500MB.

---

## Output Format

```markdown
## Worktree Cleanup Findings

### Summary
- Total worktrees checked: N
- Stale worktrees: N
- Dirty worktrees (unsaved work): N
- Total disk usage: X MB
- Cross-project stale worktrees: N (informational)

### Findings

| # | Severity | Worktree | Branch | Status | Disk | Recommended Action |
|---|----------|----------|--------|--------|------|--------------------|
| 1 | MEDIUM | .claude/worktrees/old-feat | fix/old-feat | Merged into main | 45MB | Remove + delete branch |
| 2 | HIGH | .claude/worktrees/wip | feat/wip | Has uncommitted changes | 120MB | Review — unsaved work |
| 3 | LOW | (metadata) | — | Stale reference | — | Prune |

### Cross-Project (Informational)
| Project | Path | Count | Note |
|---------|------|-------|------|
| fileHelper | /mnt/dev/fileHelper/.claude/worktrees/ | 3 | 2 appear stale |
```

If no worktrees exist, note: "No worktrees found."
