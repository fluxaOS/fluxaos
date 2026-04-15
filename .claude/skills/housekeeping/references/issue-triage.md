# Issue Triage — Subagent C Reference

Audit open issues and PRs for staleness, duplicates, and combinability. Report findings only — do NOT close or modify anything.

> (`forgejo` | `psql`; default: `forgejo`). Projects using the psql backend
> (e.g. PAT) should pass `--backend psql` or set `issue.backend_default`
> in `.fhc-config.json`. Note: `bulk`, `move`, and `report` subcommands
> do not yet support psql (see #2520).

---

## Check 1: Stale Pull Requests

PRs with no activity in 30+ days.

```bash
```

For each open PR:
- Check last updated date
- Flag PRs with **no activity in 30+ days**
- Severity: **MEDIUM**
- Recommended action: Close with inactivity comment

---

## Check 2: Stale Review Issues

Issues with state `review` that have been in review for 7+ days.

```bash
check docs/superpowers/deferred-fixes.md
```

For each review issue:
- Check last updated date
- Flag issues in review for **7+ days**
- Severity: **MEDIUM**
- Recommended action: Close (if work merged) or investigate active pipeline runs

To determine if work is merged, check if a branch or PR exists for the issue:
```bash
# Check if issue number appears in any merged branch
git branch --merged main --format='%(refname:short)' | grep -i '<issue-number>'
```

---

## Check 3: Stale Open Issues

Open issues with no activity in 60+ days that may have been forgotten.

```bash
check docs/superpowers/deferred-fixes.md
```

For each open issue:
- Check last updated date
- Skip issues with active pipeline runs (check `pat pipeline status <num>` to see if actively being worked)
- Skip issues with `priority:high` or `priority:critical` labels
- Flag issues with **no activity in 60+ days**
- Severity: **LOW**
- Recommended action: Review — close if no longer relevant, or add a comment to keep alive

---

## Check 4: Duplicate / Combinable Issues

Scan open issues for potential duplicates or issues that could be combined.

```bash
check docs/superpowers/deferred-fixes.md
```

For each pair of open issues, check for:

1. **Title similarity** — issues with very similar titles may be duplicates
   - Look for issues that reference the same file, function, or feature
   - Look for issues with near-identical descriptions

2. **Scope overlap** — issues that tackle different aspects of the same problem
   - Same component/area + related goals → suggest combining
   - One issue is a subset of another → suggest closing the subset as duplicate

3. **Superseded issues** — older issues that a newer, broader issue covers
   - If issue A (older) is a subset of issue B (newer), flag A as potentially superseded

### Classification

| Pattern | Severity | Action |
|---------|----------|--------|
| Near-identical title + description | **HIGH** | Close one as duplicate of the other |
| Same component, overlapping scope | **MEDIUM** | Suggest combining into one issue |
| Older issue superseded by newer | **MEDIUM** | Close older, reference newer |
| Similar area but distinct goals | **LOW** | Note for awareness, no action needed |

When flagging duplicates, always specify which issue should be kept (prefer the one with more context, comments, or a clearer description).

---

## Check 5: Issues with Closed PRs but Still Open

Issues that reference PRs (or have branches) that were merged, but the issue itself is still open.

```bash
# Get all open issues
check docs/superpowers/deferred-fixes.md
```

For each open issue:
1. Extract issue number
2. Check if any merged branch references this issue number:
   ```bash
   git log --all --oneline --grep="issue.*<N>\|#<N>\|closes.*<N>" | head -5
   ```
3. If the work appears merged but the issue is open → flag it
   - Severity: **HIGH**
   - Recommended action: Close the issue

---

## Output Format

```markdown
## Issue Triage Findings

### Summary
- Open issues checked: N
- Open PRs checked: N
- Items flagged: N
- Breakdown: CRITICAL: N, HIGH: N, MEDIUM: N, LOW: N

### Findings

| # | Severity | Type | Item | Description | Recommended Action |
|---|----------|------|------|-------------|--------------------|
| 1 | MEDIUM | Stale PR | PR #45 | No activity in 35 days | Close with comment |
| 2 | MEDIUM | Stale Review | Issue #120 | In review 12 days | Close (work merged) |
| 3 | HIGH | Duplicate | Issue #80 / #95 | Both address login validation | Close #80 as dup of #95 |
| 4 | HIGH | Open + Merged | Issue #110 | Branch merged, issue still open | Close issue |
| 5 | LOW | Stale | Issue #50 | No activity in 90 days | Review for relevance |
```

If no findings in a check, note it briefly (e.g., "No stale PRs found.").
