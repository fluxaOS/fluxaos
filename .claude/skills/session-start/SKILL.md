---
model: sonnet
---

# Session Start — fluxaOS

Orient the current session: clean-slate check, work context, session marker.

## Usage

```bash
/session-start
```

**Arguments:** `$ARGUMENTS`

---

## Step 0: Worktree Context

```bash
WORKTREE_DIR=$(git rev-parse --show-toplevel)
MAIN_DIR=$(git worktree list | head -1 | awk '{print $1}')
if [ "$WORKTREE_DIR" != "$MAIN_DIR" ]; then
    echo "Running in worktree: $WORKTREE_DIR"
else
    echo "Running in main checkout: $MAIN_DIR"
fi
```

---

## Step 1: Clean-Slate Check (verify only — no cleanup)

Run:

```bash
git fetch --prune origin
git status && git stash list && git branch && git branch -r && git worktree list
```

Classify every non-main branch and stash as **PROTECTED** or **ORPHAN**:

- **PROTECTED**: checked out in a worktree, has an open PR (`gh pr list --state open --json headRefName`), or is ahead of `origin/main`
- **ORPHAN**: everything else

Print PROTECTED items with reasons. For orphans, report them and ask:

```
Repo has unprotected items. Options:
  (s) start anyway
  (c) clean up first — run /housekeeping then continue
  (a) abort

Default on empty input: s
```

- **s**: continue, flag orphans in ready summary
- **c**: run housekeeping, then continue
- **a**: stop, do not write session marker

---

## Step 2: Orient

Gather context:

```bash
git log --since="72 hours ago" --oneline
gh pr list --state open --json number,title,headRefName --jq '.[] | "#\(.number) \(.title) [\(.headRefName)]"'
ls -t docs/superpowers/handoffs/ 2>/dev/null | head -3
```

Check:
- **Roadmap:** `docs/superpowers/roadmap.md` — "What's Next" section
- **Recent handoff:** read the most recent file in `docs/superpowers/handoffs/`
- **Memory index:** `~/.claude/projects/-mnt-dev-fluxaos/memory/MEMORY.md` — scan for anything relevant to the next action
- **Linear:** open issues via `mcp__plugin_linear_linear__list_issues` with `team=fluxaOS` and `state=In Progress` or `Backlog` (limit 10)

Write a brief orientation summary: what's in flight, what's blocked, natural next action. A few lines — not a report.

---

## Step 3: Write Session-Start Marker

Write to `~/.claude/projects/-mnt-dev-fluxaos/memory/session/`:

```
session-start-<ISO8601>.md
```

```markdown
---
name: "session-start <ISO8601>"
description: "Session start marker for fluxaOS at <ISO8601>"
type: "project"
---

# Session Start

Started: <ISO8601 with offset>
Branch at start: <current branch>
Origin main at start: <short SHA>

## Orientation

<paste orientation summary from Step 2>
```

If the write fails, print a warning and continue.

---

## Step 4: Ready Summary

```
Session oriented. <N PRs open>, repo <clean|N flags: reasons>, next likely action: <inferred from roadmap/handoff>.
```
