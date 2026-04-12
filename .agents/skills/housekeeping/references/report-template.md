# Housekeeping Report Template

Use this template when presenting the unified housekeeping summary to the user.

---

```markdown
# Housekeeping Report

**Project:** [project name]
**Date:** [current date]
**Mode:** [Full / Dry-run]

---

## Executive Summary

| Domain | Checked | Flagged | Critical/High | Medium | Low |
|--------|---------|---------|---------------|--------|-----|
| Git Cleanup | N | N | N | N | N |
| Worktree Cleanup | N | N | N | N | N |
| Issue Triage | N | N | N | N | N |
| **Total** | **N** | **N** | **N** | **N** | **N** |

**Health Score:** [Clean | Healthy | Needs Attention | Overdue]

---

## Detailed Findings

### Git Cleanup
[Insert subagent A findings table]

### Worktree Cleanup
[Insert subagent B findings table]

### Issue Triage
[Insert subagent C findings table]

---

## Proposed Actions

### Auto-safe (no confirmation needed)
- Delete N merged branches
- Prune N stale worktree metadata entries

### Requires Confirmation
- [ ] Delete N stale unmerged branches
- [ ] Resolve N stash list items (`git stash list`)
- [ ] Close N stale PRs
- [ ] Remove N stale worktrees
- [ ] Close N stale/duplicate issues
- [ ] Delete N orphaned branches
```

---

## Health Score Thresholds

| Score | Remaining Flagged | Meaning |
|-------|-------------------|---------|
| **Clean** | 0 | No issues found |
| **Healthy** | 1-3 | Minor items, acceptable |
| **Needs Attention** | 4-10 | Accumulating debt |
| **Overdue** | 10+ | Significant cleanup needed |

---

## Post-Action Summary

After executing approved actions, present:

```markdown
# Housekeeping Complete

**Project:** [name]
**Date:** [today]

## Actions Taken

| Area | Found | Cleaned | Skipped | Notes |
|------|-------|---------|---------|-------|
| Merged Branches | N | N deleted | 0 | Auto-safe |
| Stale Branches | N | N deleted | N declined | — |
| Stash List Items | N | N resolved | N declined | Include drop/apply/pop/kept |
| Stale PRs | N | N closed | N declined | — |
| Stale Worktrees | N | N removed | N declined | N had unsaved work |
| Issues (stale/dup) | N | N closed | N declined | — |
| Orphaned Branches | N | N deleted | N declined | — |

## Final Health Score: [Clean | Healthy | Needs Attention | Overdue]
(N remaining flagged items after cleanup)
```
