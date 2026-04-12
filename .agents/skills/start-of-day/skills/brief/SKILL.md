---
name: "start-of-day/brief"
id: "start-of-day/brief"
description: "Session orientation: summarize the past 72 hours of git activity, open issues, recent memory entries, recently modified files, and current repo state. Use at session start to orient the agent."
default_model: "sonnet"
---

# Start-of-Day Brief

Gather and present a 72-hour orientation snapshot so the agent can start the session with full context.

## Arguments

**`$ARGUMENTS`** — optional `--repo OWNER/REPO` to target a different project's issues and PRs.

Parse repo flag:
```bash
REPO_FLAG=""
if echo "$ARGUMENTS" | grep -q "\-\-repo"; then
  REPO_FLAG=$(echo "$ARGUMENTS" | grep -o '\-\-repo [^ ]*')
fi
```

## Step 1: Git History (past 72 hours)

```bash
# All commits in the past 72 hours
git log --since="72 hours ago" --oneline

# Merged PRs only
git log --since="72 hours ago" --oneline --merges
```

Count total commits and merged PRs. Group commits by EPIC or theme using issue references in commit messages (e.g., `#NNN`).

## Step 2: Open Issues

```bash
flu issue list --state open $REPO_FLAG
```

List all open issues with number, title, and labels.

## Step 3: Recent Memory Entries (past 72 hours)

```bash
flu memory list --format json --limit 50
```

Filter the JSON output to entries where `created_at` is within the past 72 hours:

```bash
CUTOFF=$(date -d "72 hours ago" --iso-8601=seconds 2>/dev/null || date -v-72H -Iseconds)
flu memory list --format json --limit 50 | \
  python3 -c "
import json, sys
from datetime import datetime, timezone, timedelta
cutoff = datetime.now(timezone.utc) - timedelta(hours=72)
entries = json.load(sys.stdin)
def parse_dt(s):
    d = datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
recent = [e for e in entries if parse_dt(e['created_at']) > cutoff]
for e in recent:
    print(f\"- {e['subject']} ({e['category']}, {e['created_at'][:10]})\")
"
```

## Step 4: Recently Modified Files (uncommitted work)

Create a 72-hour sentinel file and use it to find recently touched files:

```bash
SENTINEL=$(mktemp)
touch -d "72 hours ago" "$SENTINEL" 2>/dev/null || touch -A -720000 "$SENTINEL"

find . -newer "$SENTINEL" \
  \( -name "*.py" -o -name "*.md" -o -name "*.json" -o -name "*.yaml" -o -name "*.yml" -o -name "*.toml" \) \
  -not -path "./.git/*" \
  -not -path "./__pycache__/*" \
  -not -path "./node_modules/*" \
  -not -path "./.venv/*" \
  -not -path "./dist/*" \
  2>/dev/null | sort

rm -f "$SENTINEL"
```

Cross-reference with `git status --short` to identify which of these are **uncommitted**:

```bash
git status --short
```

Only list files that appear in both `find` output AND `git status` (i.e., modified but not yet committed).

## Step 5: Repo State

```bash
# Working tree status
git status --short

# Stashes
git stash list

# Open PRs
flu pr list --state open $REPO_FLAG
```

## Step 6: Synthesize and Present

Present findings in this format:

```
## Dev Brief — Past 72 Hours

### Volume
- N commits, N merged PRs
(or: No commits in the past 72 hours)

### What Was Built
[Group by EPIC or theme — use issue references from commit messages]
- #NNN commit message / description
(or: No commits in the past 72 hours)

### Open Issues
- #NNN Title [label] [label]
(or: No open issues)

### Recent Memory (past 72h)
- Subject (category, date)
(or: No memory entries in past 72 hours)

### Recently Modified (Uncommitted)
- path/to/file.ext
(or: Working tree clean — no uncommitted modifications)

### Repo State
- Working tree: [clean | N modified files, N untracked]
- Stashes: [none | N stash(es)]
- Open PRs: [none | #N Title, #N Title]

### Key Observations
[2–4 synthesized insights: patterns, risks, what needs attention, what's next]
```

Keep Key Observations actionable — surface anomalies, incomplete work, or anything that should inform this session.
