---
model: sonnet
---

# Session End — fluxaOS

Wrap up the current session: summarize, write handoff, clean up, write end marker.

## Usage

```bash
/session-end
/session-end --dry-run     # Report only, skip writes
```

**Arguments:** `$ARGUMENTS`

---

## Step 0: Parse Arguments

- `--dry-run` → set `DRY_RUN=true` (skip all writes and destructive actions)

---

## Step 1: Find Session Boundary

Look for the most recent session-start marker in `~/.claude/projects/-mnt-dev-fluxaos/memory/session/`:

```bash
ls -t ~/.claude/projects/-mnt-dev-fluxaos/memory/session/session-start-*.md 2>/dev/null | head -1
```

Extract the timestamp from the filename (`session-start-<ISO8601>.md`). Set `SESSION_START` to that value.

If no session-start marker exists, fall back to:

```bash
git log -1 --format=%cI origin/main
```

Set `SESSION_BOUNDARY_REASON="No session-start marker found; using last origin/main commit as boundary."` and continue.

---

## Step 2: Recap

```bash
git log --since="$SESSION_START" --oneline
gh pr list --state merged --json number,title,mergedAt --jq '.[] | select(.mergedAt > "'$SESSION_START'") | "#\(.number) \(.title)"'
```

Group commits by theme. Note what shipped, what's still in progress, anything notable for next session. Prose — no fixed template.

---

## Step 3: Write Handoff Document

Location: `docs/superpowers/handoffs/YYYY-MM-DD-<topic>-session-handoff.md`

Derive `<topic>`:
1. **Conventional commit scope** from the topmost session commit: `git log --since="$SESSION_START" -1 --format=%s` — if it matches `type(scope): msg`, use the scope, slugified.
2. **Most-touched directory** if no scope: `git log --since="$SESSION_START" --name-only --pretty=format: | grep -v '^$' | awk -F/ 'NF>1{print $1"/"$2} NF==1{print $1}' | sort | uniq -c | sort -rn | head -1 | awk '{print $2}'`, slugified.
3. **`general`** if neither yields anything.

Never overwrite. If the target path exists, append `-2`, `-3`, etc.

Include only sections that apply:
- What was accomplished (by theme/Linear issue)
- Session boundary (include `SESSION_BOUNDARY_REASON` if set)
- Linear issues closed this session (with IDs)
- Linear issues still in progress
- Open PRs awaiting action
- E2e test results (if UI work was done)
- Known deferred issues filed (FLX-NNN titles)
- Unfinished work (branch names, issue numbers)
- Architecture/context decisions made
- Next session: recommended starting point

Header: project name, session-end timestamp, model, branch, HEAD SHA.

If `DRY_RUN=true`, print to stdout instead.

---

## Step 4: Ship Pending Work

If `DRY_RUN=true`, skip.

Check for uncommitted changes and unpushed commits:

```bash
git status --short
git log --oneline "origin/$(git branch --show-current)..HEAD" 2>/dev/null || true
```

If there are uncommitted changes (excluding the handoff doc just written):

```
Pending changes detected:
  <summary>

Options:
  (y) commit as WIP: git add . && git commit -m "WIP: session-end $(date -I)"
  (n) leave as-is — noted in handoff

Default on empty input: n
```

- **y**: commit WIP, note SHA in handoff
- **n**: add "Unfinished Work" note to handoff

For feature branches with unpushed commits: push and open a PR via `gh pr create`.

---

## Step 5: Update Linear

For each Linear issue that was completed this session, mark it Done:

```
mcp__plugin_linear_linear__save_issue  id=FLX-NNN  state=Done
```

For issues newly discovered/filed this session (deferred bugs, follow-ups), confirm they are in Backlog with accurate titles.

---

## Step 6: Write Session-End Marker

If `DRY_RUN=true`, skip.

Write to `~/.claude/projects/-mnt-dev-fluxaos/memory/session/`:

```
session-end-<ISO8601>.md
```

```markdown
---
name: "session-end <ISO8601>"
description: "Session end marker for fluxaOS at <ISO8601>"
type: "project"
---

# Session End

Ended: <ISO8601 with offset>
Branch at end: <current branch>
HEAD: <short SHA>
Handoff: docs/superpowers/handoffs/<filename>.md

## Summary

<2-3 sentence summary of what shipped and what's next>
```

If the write fails, print a warning — do not block the success line.

---

## Step 7: Worktree Cleanup

If running in a worktree (not the main checkout):

```bash
WORKTREE_DIR=$(git rev-parse --show-toplevel)
MAIN_DIR=$(git worktree list | head -1 | awk '{print $1}')
if [ "$WORKTREE_DIR" != "$MAIN_DIR" ]; then
    cd "$MAIN_DIR"
    git worktree remove "$WORKTREE_DIR" --force
    git worktree prune
fi
```

---

## Step 8: Final Success Line

Only print if all steps succeeded:

```
Session closed. Handoff written, repo clean, Linear updated.
```
