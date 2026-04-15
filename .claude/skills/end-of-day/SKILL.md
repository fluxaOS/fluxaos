---
model: sonnet
---
# End of Day

Close out the session: recap what was built, clean the repo, capture work in memory.

## Usage

```
/end-of-day    # Full run: recap → housekeeping → digest prompt
```

**Arguments:** `$ARGUMENTS`

---

## Step 1: Find Session Start Time

Query memory for the most recent `start-of-day` session marker:

```bash
flu memory search "start-of-day" --category session --limit 1 --format json | \
  python3 -c "
import json, sys
from datetime import datetime, timezone, timedelta
results = json.load(sys.stdin)
if not results:
    dt = datetime.now(timezone.utc) - timedelta(hours=9)
    print(dt.isoformat())
else:
    print(results[0]['created_at'])
" 2>/dev/null
```

Store this as `SOD_TIMESTAMP`. Also extract the date portion as `SOD_DATE` (YYYY-MM-DD):

```bash
SOD_DATE=$(echo "$SOD_TIMESTAMP" | cut -c1-10)
```

If no session marker exists (start-of-day was not run today), use 9 hours ago as the fallback and note: "No start-of-day marker found — using 9-hour fallback."

---

## Step 2: Session Recap

> **Issue Backend:** All `flu issue` commands accept `--backend BACKEND`
> (`forgejo` | `psql`; default: `forgejo`). Projects using the psql backend
> (e.g. PAT) should pass `--backend psql` or set `issue.backend_default`
> in `.fhc-config.json`. Note: `bulk`, `move`, and `report` subcommands
> do not yet support psql (see #2520).

```bash
# All commits since SOD
git log --since="$SOD_TIMESTAMP" --oneline

# Merged PRs since SOD
git log --since="$SOD_TIMESTAMP" --oneline --merges

# Issues closed since SOD
flu issue list --state closed --since $SOD_DATE
```

Present in this format:

```
## Session Recap

### What Was Built
[Group by EPIC or theme — use issue references from commit messages]
- #NNN commit message / description
(or: No commits this session)

### Issues Closed This Session
- #NNN Title
(or: No issues closed this session)

### Key Observations
[2-3 lines: what's notable, what's unfinished, anything that needs attention next session]
```

---

## Step 3: Housekeeping

Announce: "Running housekeeping to clean up the repo..."

Invoke the `housekeeping` skill. It will spawn its own parallel audits and present findings for approval before taking any action. Wait for it to complete before continuing.

---

## Step 4: Memory Digest Prompt

After housekeeping completes, re-use the closed issues list from Step 2. If there were issues closed this session, present:

```
## Memory Digest

The following issues were closed this session:
- #NNN Title
- #NNN Title

To capture this work in memory, run:
  flu memory digest --issue NNN
  flu memory digest --issue NNN

Run these now? (y = run all / n = skip / enter specific numbers separated by spaces)
```

- If **y**: run `flu memory digest --issue <N>` for each closed issue in sequence, report results.
- If **n**: skip, note "Skipped — run manually when ready."
- If numbers provided (e.g. "42 57"): run only those issue numbers.

If no issues were closed this session: skip this step silently.

---

## Step 5: Write Session End Marker

Record that the session ended:

```bash
flu memory add session "end-of-day" \
  --tags "session-end" \
  --body "Session ended at $(date -Iseconds)"
```

Then print the closing summary:

```
Session closed. Recap saved, repo cleaned, memory updated.
```
